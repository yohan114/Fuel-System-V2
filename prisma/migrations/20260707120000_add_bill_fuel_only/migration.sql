-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "brand" TEXT,
    "typeLabel" TEXT,
    "model" TEXT,
    "regNo" TEXT,
    "capacity" TEXT,
    "yom" INTEGER,
    "chassisNo" TEXT,
    "engineNo" TEXT,
    "serialNo" TEXT,
    "site" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "meterType" TEXT NOT NULL,
    "dailyCapLitres" INTEGER,
    "ownership" TEXT NOT NULL DEFAULT 'OWNED',
    "hireSupplier" TEXT,
    "hireRateCents" INTEGER,
    "hireRateBasis" TEXT,
    "hireStart" DATETIME,
    "hireEnd" DATETIME,
    "hireNote" TEXT,
    "minBillHours" INTEGER,
    "billFuelOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "categoryId" TEXT NOT NULL,
    "projectId" TEXT,
    CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("brand", "capacity", "categoryId", "chassisNo", "code", "createdAt", "dailyCapLitres", "engineNo", "hireEnd", "hireNote", "hireRateBasis", "hireRateCents", "hireStart", "hireSupplier", "id", "meterType", "minBillHours", "model", "ownership", "projectId", "regNo", "serialNo", "site", "status", "typeLabel", "updatedAt", "yom") SELECT "brand", "capacity", "categoryId", "chassisNo", "code", "createdAt", "dailyCapLitres", "engineNo", "hireEnd", "hireNote", "hireRateBasis", "hireRateCents", "hireStart", "hireSupplier", "id", "meterType", "minBillHours", "model", "ownership", "projectId", "regNo", "serialNo", "site", "status", "typeLabel", "updatedAt", "yom" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

