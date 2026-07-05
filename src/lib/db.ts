import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

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
