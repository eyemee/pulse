import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Prisma 7 connects through a driver adapter. We hand it our own pg Pool so
// the connection behaviour is explicit.
//
// Reuse a single PrismaClient across hot reloads (dev) and warm serverless
// invocations to avoid exhausting Postgres connections. Use a *pooled*
// connection string for DATABASE_URL in production (PgBouncer / Neon pooler).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Neon (and most hosted Postgres / PgBouncer setups) silently drop idle
  // connections, and Neon's free tier suspends the database after a few idle
  // minutes. With pg's defaults the pool kept those dead sockets and handed
  // them out again, so requests hung for ~30s and then failed with
  // "Connection terminated unexpectedly" / ETIMEDOUT. Recycle idle
  // connections well before the server would, keep live ones warm, and fail
  // fast instead of hanging when a connection can't be made.
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    // Cap any single statement so a stuck query can't hold a request open.
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  // A connection dying while idle in the pool emits "error" on the pool; with
  // no listener Node treats it as an uncaught exception. The pool discards the
  // client either way, so logging is enough.
  pool.on("error", (err) => {
    console.warn("[pulse] idle database connection dropped:", err.message);
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
