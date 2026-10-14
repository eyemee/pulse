import { prisma } from "@/lib/prisma";
import { isValidPeerId, isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";
import { allow, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/block — body { secret, targetId }.
// Ends any connection or pending request between the two, deletes signals
// between them, and records a block. From then on neither appears on the
// other's map and requests between them are refused (see poll + signal).
// The blocked person isn't told; to them it looks like the other person
// left. (They could reload for a fresh identity: an anonymous app can't
// prevent that, so this protects the moment, not forever.)
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isValidSecret(body.secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  const me = publicIdFromSecret(body.secret);
  const target = body.targetId;
  if (!isValidPeerId(target) || target === me) {
    return Response.json({ error: "invalid target" }, { status: 400 });
  }
  if (!(await allow({ key: `block:id:${me}`, max: 20, windowSec: 60 }))) return tooMany(60);

  const exists = await prisma.presence.findUnique({ where: { id: me }, select: { id: true } });
  if (!exists) return Response.json({ error: "not joined" }, { status: 401 });

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: me, blockedId: target } },
    create: { blockerId: me, blockedId: target },
    update: {},
  });

  // Free both sides of whatever was going on between them.
  await prisma.presence.updateMany({
    where: { id: me },
    data: { busy: false, peerId: null },
  });
  await prisma.presence.updateMany({
    where: { id: target, peerId: me },
    data: { busy: false, peerId: null },
  });
  await prisma.signal.deleteMany({
    where: {
      OR: [
        { fromId: me, toId: target },
        { fromId: target, toId: me },
      ],
    },
  });
  // Tell their client the conversation is over (looks like a normal end).
  await prisma.signal.create({
    data: { fromId: me, toId: target, type: "end", payload: null },
  });

  return Response.json({ ok: true });
}
