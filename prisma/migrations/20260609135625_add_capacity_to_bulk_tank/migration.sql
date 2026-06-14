/*
  Warnings:

  - Added the required column `capacity` to the `BulkTank` table without a default value. This is not possible if the table is not empty.

*/
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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BulkTank" ("balance", "createdAt", "fuelKind", "id", "name", "updatedAt") SELECT "balance", "createdAt", "fuelKind", "id", "name", "updatedAt" FROM "BulkTank";
DROP TABLE "BulkTank";
ALTER TABLE "new_BulkTank" RENAME TO "BulkTank";
CREATE UNIQUE INDEX "BulkTank_name_key" ON "BulkTank"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
