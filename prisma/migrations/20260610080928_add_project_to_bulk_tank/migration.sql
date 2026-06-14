-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BulkTank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fuelKind" TEXT NOT NULL,
    "capacity" REAL NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT,
    CONSTRAINT "BulkTank_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BulkTank" ("balance", "capacity", "createdAt", "fuelKind", "id", "name", "updatedAt") SELECT "balance", "capacity", "createdAt", "fuelKind", "id", "name", "updatedAt" FROM "BulkTank";
DROP TABLE "BulkTank";
ALTER TABLE "new_BulkTank" RENAME TO "BulkTank";
CREATE UNIQUE INDEX "BulkTank_name_key" ON "BulkTank"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
