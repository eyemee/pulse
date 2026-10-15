import { prisma } from "@/lib/prisma";
import { isValidPeerId, isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";
import type { SignalType } from "@/lib/types";
import { allowAll, clientIp, tooMany, type Limit } from "@/lib/rateLimit";
import { sanitizeIcePayload, sanitizeSdpPayload } from "@/lib/ice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { secret, toId, type, payload? }
// Drops one message into the recipient's mailbox, if it fits the current
// connection state. Also manages `busy` / `peerId` so a user can only be in
// one connection at a time.
export async function POST(request: Request) {
  const body = await readJson(request, MAX_PAYLOAD + 1024);
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });

  const { secret, toId, type, payload } = body;
  if (!isValidSecret(secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  // The sender is whoever holds the secret. It used to be a free-form
  // `fromId` in the body, so anyone could send signals as anyone.
  const fromId = publicIdFromSecret(secret);
  if (!isValidPeerId(toId) || toId === fromId) {
    return Response.json({ error: "invalid recipient" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  let payloadStr = typeof payload === "string" ? payload : null;

  // SDP/ICE messages carry a JSON payload; control messages carry none.
  const needsPayload =
    signalType === "offer" || signalType === "answer" || signalType === "ice";
  if (needsPayload !== (payloadStr !== null) || (payloadStr && !isJson(payloadStr))) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  // Relay-only enforcement. Only relay candidates may cross the mailbox, with
  // their related address zeroed (see lib/ice.ts). The current client never
  // sends anything else; this covers tabs still running a pre-relay bundle
  // and any client that ignores iceTransportPolicy.
  if (payloadStr && relayEnforced()) {
    payloadStr =
      signalType === "ice" ? sanitizeIcePayload(payloadStr) : sanitizeSdpPayload(payloadStr);
    if (payloadStr === null) {
      return Response.json({ error: "only relay candidates are accepted" }, { status: 400 });
    }
  }

  // A call setup is a few dozen signals (ICE trickle); video renegotiation
  // adds more. Requests get much tighter limits: they're what lands on a
  // stranger's screen, so they're the harassment vector.
  const limits: Limit[] = [
    { key: `sig:id:${fromId}`, max: 300, windowSec: 60 },
    { key: `sig:ip:${clientIp(request)}`, max: 600, windowSec: 60 },
  ];
  if (signalType === "request") {
    limits.push(
      { key: `req:id:${fromId}`, max: 10, windowSec: 60 },
      { key: `req:pair:${fromId}:${toId}`, max: 3, windowSec: 120 },
    );
  }
  if (!(await allowAll(limits))) return tooMany(signalType === "request" ? 60 : 10);

  const me = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { busy: true, peerId: true },
  });
  if (!me) return Response.json({ error: "not joined" }, { status: 401 });

  const deliver = () =>
    prisma.signal.create({
      data: { fromId, toId, type: signalType, payload: payloadStr },
    });
  const reject = (error: string) => Response.json({ error }, { status: 409 });

  // Server-side state machine. Previously any signal was relayed to anyone,
  // so e.g. a forged "accept" could mark any stranger busy (unreachable), and
  // offers could be pushed at people who never agreed to connect.
  //
  //   request: me -> target       me.peerId = target          (not busy)
  //   accept:  target -> me       only if requester.peerId == me, both busy
  //   offer/answer/ice            only between the two busy partners
  //   decline / end               only clear rows that point at each other
  switch (signalType) {
    case "request": {
      if (me.busy) return reject("already in a connection");
      const [target, blocked] = await Promise.all([
        prisma.presence.findUnique({ where: { id: toId }, select: { busy: true } }),
        prisma.block.findFirst({
          where: {
            OR: [
              { blockerId: toId, blockedId: fromId },
              { blockerId: fromId, blockedId: toId },
            ],
          },
          select: { blockerId: true },
        }),
      ]);
      // Blocked either way: indistinguishable from "they're unavailable".
      if (!target || target.busy || blocked) {
        // Offline or in another chat: auto-decline instead of delivering.
        await sendDecline(toId, fromId);
        return Response.json({ ok: true, autoDeclined: true });
      }
      await prisma.presence.update({ where: { id: fromId }, data: { peerId: toId } });
      await deliver();
      break;
    }
    case "accept": {
      if (me.busy) return reject("already in a connection");
      // Claim the requester only if they really asked for us and are still
      // waiting. Conditional update so two accepts can't both win.
      const claimed = await prisma.presence.updateMany({
        where: { id: toId, peerId: fromId, busy: false },
        data: { busy: true },
      });
      if (claimed.count === 0) return reject("no pending request from this user");
      await prisma.presence.update({
        where: { id: fromId },
        data: { busy: true, peerId: toId },
      });
      await deliver();
      break;
    }
    case "decline": {
      const cleared = await prisma.presence.updateMany({
        where: { id: toId, peerId: fromId, busy: false },
        data: { peerId: null },
      });
      if (cleared.count === 0) return reject("no pending request from this user");
      await deliver();
      break;
    }
    case "offer":
    case "answer":
    case "ice": {
      if (!me.busy || me.peerId !== toId) return reject("not connected to this user");
      await deliver();
      break;
    }
    case "end": {
      // Always free yourself; only touch / notify the other side if one of
      // you was actually dealing with the other.
      const wasMine = me.peerId === toId;
      await prisma.presence.update({
        where: { id: fromId },
        data: { busy: false, peerId: null },
      });
      const theirs = await prisma.presence.updateMany({
        where: { id: toId, peerId: fromId },
        data: { busy: false, peerId: null },
      });
      if (wasMine || theirs.count > 0) await deliver();
      break;
    }
  }

  return Response.json({ ok: true });
}

// On whenever TURN is configured (then /api/ice only hands out relay
// servers). Without TURN keys calls fall back to STUN, so nothing is filtered.
function relayEnforced(): boolean {
  return Boolean(process.env.TURN_KEY_ID && process.env.TURN_KEY_API_TOKEN);
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
