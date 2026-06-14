-- CreateTable
CREATE TABLE "BulkTank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fuelKind" TEXT NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BulkRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelKind" TEXT NOT NULL,
    "requestedLitres" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "bulkTankId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    CONSTRAINT "BulkRequest_bulkTankId_fkey" FOREIGN KEY ("bulkTankId") REFERENCES "BulkTank" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BulkRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BulkRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FuelIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelKind" TEXT NOT NULL,
    "litres" REAL NOT NULL,
    "meterReading" REAL,
    "readingType" TEXT,
    "pricePerLitre" INTEGER NOT NULL,
    "totalCost" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "fuelPriceId" TEXT,
    "linkedRequestId" TEXT,
    "meterReadingRecordId" TEXT,
    "bulkTankId" TEXT,
    CONSTRAINT "FuelIssue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_fuelPriceId_fkey" FOREIGN KEY ("fuelPriceId") REFERENCES "FuelPrice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_linkedRequestId_fkey" FOREIGN KEY ("linkedRequestId") REFERENCES "FuelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_bulkTankId_fkey" FOREIGN KEY ("bulkTankId") REFERENCES "BulkTank" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FuelIssue" ("assetId", "createdAt", "fuelKind", "fuelPriceId", "id", "issueDate", "issuedById", "linkedRequestId", "litres", "meterReading", "meterReadingRecordId", "pricePerLitre", "readingType", "source", "totalCost") SELECT "assetId", "createdAt", "fuelKind", "fuelPriceId", "id", "issueDate", "issuedById", "linkedRequestId", "litres", "meterReading", "meterReadingRecordId", "pricePerLitre", "readingType", "source", "totalCost" FROM "FuelIssue";
DROP TABLE "FuelIssue";
ALTER TABLE "new_FuelIssue" RENAME TO "FuelIssue";
CREATE UNIQUE INDEX "FuelIssue_linkedRequestId_key" ON "FuelIssue"("linkedRequestId");
CREATE UNIQUE INDEX "FuelIssue_meterReadingRecordId_key" ON "FuelIssue"("meterReadingRecordId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "projectId" TEXT,
    "bulkTankId" TEXT,
    CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_bulkTankId_fkey" FOREIGN KEY ("bulkTankId") REFERENCES "BulkTank" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "createdById", "email", "id", "name", "passwordHash", "projectId", "role", "updatedAt", "username") SELECT "active", "createdAt", "createdById", "email", "id", "name", "passwordHash", "projectId", "role", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BulkTank_name_key" ON "BulkTank"("name");
