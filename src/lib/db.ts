import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

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

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Initialize WAL mode for SQLite to prevent lock issues during heavy reads/writes
prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;")
  .then(() => {
    // WAL mode successfully enabled
  })
  .catch((err) => {
    console.error("Failed to enable WAL mode on SQLite:", err);
  });
