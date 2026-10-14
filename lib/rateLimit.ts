// Fixed-window rate limiting backed by Postgres.
//
// In-memory counters don't work on Vercel: each serverless instance has its
// own memory and instances come and go, so a limit of N would really be
// N x (number of warm instances). One atomic upsert per check keeps the
// count shared. Fixed windows allow a burst of up to 2x at a window edge,
// which is fine for abuse limits.
import { prisma } from "@/lib/prisma";

export interface Limit {
  key: string;
  max: number;
  windowSec: number;
}

// True if the call is allowed. Increments the counter either way.
export async function allow({ key, max, windowSec }: Limit): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::double precision)
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::double precision)
        THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  return Number(rows[0]?.count ?? 0) <= max;
}

// Check several limits; stops at the first one that's exceeded.
export async function allowAll(limits: Limit[]): Promise<boolean> {
  for (const l of limits) {
    if (!(await allow(l))) return false;
  }
  return true;
}

export function tooMany(retryAfterSec = 30): Response {
  return Response.json(
    { error: "too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

// Best-effort client IP. On Vercel, x-forwarded-for is set by the platform
// (the left-most entry is the client). Elsewhere it can be spoofed, which is
// why every limit that matters is also keyed by session id.
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return request.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}
