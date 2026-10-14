import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import { isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";
import type { PollResponse } from "@/lib/types";
import { allow, tooMany } from "@/lib/rateLimit";

interface InboxRow {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  payload: string | null;
  createdAt: Date | string;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/poll — body { secret }. The single endpoint that drives the live
// map. It (1) heartbeats the caller, (2) reaps stale presence + orphan
// signals, (3) returns the filtered online peers, and (4) drains this user's
// mailbox. POST rather than GET so the secret never lands in a URL (and from
// there in server, proxy or browser history logs).
export async function POST(request: Request) {
  const body = await readJson(request, 1024);
  if (!body || !isValidSecret(body.secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  const id = publicIdFromSecret(body.secret);

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // Queries that don't depend on each other run in parallel. Each database
  // round trip is ~1ms on Vercel (same region as the DB) but ~200ms from
  // further away, and this used to make 5-6 of them back to back, so a poll
  // could take well over a second locally. Now it's two rounds: limits +
  // heartbeat, then peers + mailbox.
  const [allowed, heartbeat] = await Promise.all([
    // The client polls every 1.5s (~40/min). Far above that is a script.
    allow({ key: `poll:${id}`, max: 120, windowSec: 60 }),
    // Heartbeat — refresh lastSeen for the caller only. This used to have an
    // empty `where`, which refreshed every row on every poll, so nobody ever
    // went stale and closed tabs stayed on the map while anyone was online.
    // A single UPDATE: Prisma's updateMany wraps the statement in its own
    // transaction (BEGIN/UPDATE/COMMIT), which costs extra round trips and
    // is what failed with "Transaction already closed" over a slow link.
    prisma.$executeRaw`UPDATE "Presence" SET "lastSeen" = ${new Date(now)} WHERE "id" = ${id}`,
  ]);
  if (!allowed) return tooMany(5);

  // No row means we were reaped (tab throttled in the background, laptop
  // slept, DB restarted). Tell the client so it can re-join instead of
  // silently staying invisible to everyone else.
  const present = heartbeat > 0;
  if (!present) {
    // Not joined (or reaped): nothing to see until /api/join succeeds. This
    // also stops unjoined callers from scraping everyone's positions.
    const empty: PollResponse = { present: false, peers: [], signals: [] };
    return Response.json(empty);
  }

  // Housekeeping (independent deletes; no transaction, which is unreliable
  // over a PgBouncer pooler). It doesn't need to run on every poll from every
  // client: the peer query filters stale rows anyway, so ~1 in 4 is plenty.
  // A failure here must never fail the poll itself.
  const housekeeping =
    Math.random() < 0.25
      ? Promise.all([
          prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } }),
          prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } }),
          prisma.rateLimit.deleteMany({
            where: { windowStart: { lt: new Date(now - 10 * 60_000) } },
          }),
        ]).catch((err) => console.warn("[pulse] poll housekeeping failed:", err))
      : Promise.resolve();

  const [peers, inbox] = await Promise.all([
    // Online peers, excluding self.
    prisma.presence.findMany({
      where: { id: { not: id }, lastSeen: { gte: staleCutoff } },
      select: { id: true, lat: true, lng: true, busy: true },
    }),
    // Drain this user's mailbox in one atomic statement: DELETE ... RETURNING
    // hands back exactly the rows it removed, so a signal inserted meanwhile
    // is never lost (and it's one round trip instead of read + delete).
    prisma.$queryRaw<InboxRow[]>`
      DELETE FROM "Signal" WHERE "toId" = ${id}
      RETURNING "id", "fromId", "toId", "type", "payload", "createdAt"`,
    housekeeping,
  ]);
  inbox.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const response: PollResponse = {
    present,
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: new Date(s.createdAt).toISOString(),
    })),
  };

  return Response.json(response);
}
