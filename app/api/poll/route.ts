import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import { isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";
import type { PollResponse } from "@/lib/types";
import { allow, tooMany } from "@/lib/rateLimit";

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

  // The client polls every 1.5s (~40/min). Anything far above that is a
  // script hammering the database.
  if (!(await allow({ key: `poll:${id}`, max: 120, windowSec: 60 }))) {
    return tooMany(5);
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller only. This used to have an
  // empty `where`, which refreshed every row on every poll, so nobody ever
  // went stale and closed tabs stayed on the map while anyone was online.
  const heartbeat = await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  });
  // No row means we were reaped (tab throttled in the background, laptop
  // slept, DB restarted). Tell the client so it can re-join instead of
  // silently staying invisible to everyone else.
  const present = heartbeat.count > 0;
  if (!present) {
    // Not joined (or reaped): nothing to see until /api/join succeeds. This
    // also stops unjoined callers from scraping everyone's positions.
    const empty: PollResponse = { present: false, peers: [], signals: [] };
    return Response.json(empty);
  }

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  // Housekeeping doesn't need to run on every poll from every client; the
  // peer query below filters stale rows anyway. ~1 in 4 polls is plenty
  // and cuts three writes from most requests.
  if (Math.random() < 0.25) {
    await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
    await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });
    await prisma.rateLimit.deleteMany({
      where: { windowStart: { lt: new Date(now - 10 * 60_000) } },
    });
  }

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

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
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
