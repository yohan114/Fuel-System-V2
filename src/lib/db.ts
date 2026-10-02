import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
  prismaReady: Promise<void>;
};

// Next.js loads .env for the running app, but a bare `npx tsx scripts/...` does
// not. Without this a maintenance script silently falls back to the bundled
// data/app.db while the server serves an entirely different file — it reports a
// healthy import and the live site never changes. Consulted only when nothing
// has already supplied a URL, so an explicit override on the command line and
// the app's own runtime environment both still win.
if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL) {
  try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile(); }
  catch { /* no .env alongside the app — fall through to the default below */ }
}

const adapter = new PrismaBetterSqlite3({
  // FUEL_DATABASE_URL first so this app keeps its own DB when co-hosted in the
  // unified E&C server, where a bare DATABASE_URL would be ambiguous.
  url: process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db",
});

// The query log turns into tens of MB per request on hot pages like /reports,
// so it is off by default. Set PRISMA_LOG_QUERIES=1 to re-enable it while
// profiling a specific endpoint — it never comes on just because NODE_ENV says
// development, which was the previous behaviour and the reason local navigation
// felt slower than production for the same work.
const prismaLog: ("query" | "error" | "warn")[] =
  process.env.PRISMA_LOG_QUERIES === "1"
    ? ["query", "error", "warn"]
    : ["error"];

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: prismaLog,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite is the primary bottleneck on page clicks — the defaults are tuned for
// an embedded app with one user, not a Next.js server reading thousands of rows
// per request. These pragmas are a one-time cost and must run before anything
// else touches the DB, so we build a module-scoped promise and await it on the
// first query path (and in explicit callers that cannot race it).
//
// WAL: concurrent readers while a writer is active — essential under Next's
//   request fan-out.
// synchronous=NORMAL: safe under WAL (fsync at checkpoints, not every commit)
//   and buys ~5-10× on writes.
// temp_store=MEMORY: sorts, GROUP BY, temp indexes stay in RAM instead of
//   spilling to disk.
// cache_size=-20000: 20 MB page cache per connection (negative = KB).
// mmap_size=256 MB: lets SQLite memory-map the DB file so reads skip the
//   syscall path when the OS has pages cached.
// busy_timeout=5000: a reader waits up to 5 s for the writer instead of
//   returning SQLITE_BUSY immediately — fewer transient 500s under load.
// foreign_keys=ON: match Prisma's assumption; off by default in SQLite.
async function initPragmas() {
  const stmts = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA temp_store=MEMORY",
    "PRAGMA cache_size=-20000",
    "PRAGMA mmap_size=268435456",
    "PRAGMA busy_timeout=5000",
    "PRAGMA foreign_keys=ON",
  ];
  for (const s of stmts) {
    try { await prisma.$executeRawUnsafe(s); }
    catch (err) {
      console.error(`[db] failed to apply ${s}:`, err);
    }
  }
}

export const prismaReady: Promise<void> =
  globalForPrisma.prismaReady || initPragmas();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaReady = prismaReady;
