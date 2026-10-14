import { prisma } from "@/lib/prisma";
import { STALE_MS } from "@/lib/presence";
import { allow, clientIp, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/count — { online }. Just a number, no ids or positions, so the
// entry screen can show the map is alive before someone joins (poll only
// returns positions to people who are on the map themselves).
export async function GET(request: Request) {
  if (!(await allow({ key: `count:ip:${clientIp(request)}`, max: 30, windowSec: 60 }))) {
    return tooMany(30);
  }
  const online = await prisma.presence.count({
    where: { lastSeen: { gte: new Date(Date.now() - STALE_MS) } },
  });
  return Response.json({ online });
}
