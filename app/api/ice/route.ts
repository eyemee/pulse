import { prisma } from "@/lib/prisma";
import { isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";
import { allowAll, clientIp, tooMany } from "@/lib/rateLimit";
import { usableTurnServers } from "@/lib/ice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long a TURN credential works. Must outlast the longest call; a dead
// credential mid-call drops the relay.
const CREDENTIAL_TTL_SEC = 4 * 60 * 60;

// POST /api/ice — body { secret }. Returns { iceServers, relayOnly }.
//
// Short-lived TURN credentials, minted per connection. Only handed out to
// someone in a live, mutual connection (both sides busy and pointing at each
// other), so people browsing the map can't burn relay quota, and a leaked
// credential expires on its own.
//
// TURN is opt-in: the requirements say Pulse must deploy with no external
// services. With TURN_KEY_ID / TURN_KEY_API_TOKEN set, calls are relay-only
// and neither side sees the other's IP. Without them, calls fall back to
// STUN (direct peer-to-peer), which works but exposes each side's public IP
// to the other. If the relay is configured but down, calls are refused
// rather than silently downgraded.
export async function POST(request: Request) {
  const body = await readJson(request, 1024);
  if (!body || !isValidSecret(body.secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  const id = publicIdFromSecret(body.secret);

  // One connection needs one credential (two if a call retries). Above this
  // someone is farming credentials.
  if (!(await allowAll([
    { key: `ice:id:${id}`, max: 6, windowSec: 60 },
    { key: `ice:ip:${clientIp(request)}`, max: 30, windowSec: 60 },
  ]))) {
    return tooMany(30);
  }

  const me = await prisma.presence.findUnique({
    where: { id },
    select: { busy: true, peerId: true },
  });
  if (!me?.busy || !me.peerId) {
    return Response.json({ error: "not connected" }, { status: 403 });
  }
  const partner = await prisma.presence.findUnique({
    where: { id: me.peerId },
    select: { busy: true, peerId: true },
  });
  if (!partner?.busy || partner.peerId !== id) {
    return Response.json({ error: "not connected" }, { status: 403 });
  }

  const keyId = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  if (!keyId || !token) {
    return Response.json({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      relayOnly: false,
    });
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SEC }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`TURN credential request failed: ${res.status}`);
    const data = (await res.json()) as { iceServers?: unknown };
    const iceServers = usableTurnServers(data.iceServers);
    if (iceServers.length === 0) throw new Error("TURN response had no usable servers");
    return Response.json(
      { iceServers, relayOnly: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[pulse] TURN credentials:", err);
    return Response.json({ error: "relay unavailable" }, { status: 502 });
  }
}
