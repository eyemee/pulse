import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { isValidSecret, offsetSeed, publicIdFromSecret, readJson } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { secret, lat, lng } (raw coords).
// Derives the public id from the private secret, applies a 1–3 km privacy
// offset (stable for this session) and upserts the presence row. Raw
// coordinates are never stored. Returns { id } — the caller's public id.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });

  const { secret, lat, lng } = body;
  if (!isValidSecret(secret)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const id = publicIdFromSecret(secret);
  const offset = applyPrivacyOffset(lat as number, lng as number, offsetSeed(secret));

  await prisma.presence.upsert({
    where: { id },
    create: { id, lat: offset.lat, lng: offset.lng, busy: false, lastSeen: new Date() },
    update: { lat: offset.lat, lng: offset.lng, lastSeen: new Date() },
  });

  return Response.json({ id });
}
