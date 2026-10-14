import { prisma } from "@/lib/prisma";
import { isValidSecret, publicIdFromSecret, readJson } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { secret }. Removes the caller's presence row and
// any pending signals to/from them. Called via navigator.sendBeacon on tab
// close, so the body arrives as text/plain; readJson handles both.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isValidSecret(body.secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  const id = publicIdFromSecret(body.secret);

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  return Response.json({ ok: true });
}
