-- CreateTable
CREATE TABLE "FuelIssueCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelIssueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "newLitres" REAL,
    "newMeterReading" REAL,
    "newReadingType" TEXT,
    "newFuelKind" TEXT,
    "newIssueDate" DATETIME,
    "origLitres" REAL NOT NULL,
    "origMeterReading" REAL,
    "origFuelKind" TEXT NOT NULL,
    "origIssueDate" DATETIME NOT NULL,
    "origSource" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT,
    "projectCode" TEXT,
    "docData" BLOB NOT NULL,
    "docName" TEXT NOT NULL,
    "docMime" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FuelIssueCorrection_fuelIssueId_fkey" FOREIGN KEY ("fuelIssueId") REFERENCES "FuelIssue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FuelIssueCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssueCorrection_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" DATETIME,
    CONSTRAINT "FuelIssue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_fuelPriceId_fkey" FOREIGN KEY ("fuelPriceId") REFERENCES "FuelPrice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_linkedRequestId_fkey" FOREIGN KEY ("linkedRequestId") REFERENCES "FuelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_bulkTankId_fkey" FOREIGN KEY ("bulkTankId") REFERENCES "BulkTank" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FuelIssue" ("assetId", "bulkTankId", "createdAt", "fuelKind", "fuelPriceId", "id", "issueDate", "issuedById", "linkedRequestId", "litres", "meterReading", "meterReadingRecordId", "pricePerLitre", "readingType", "source", "totalCost") SELECT "assetId", "bulkTankId", "createdAt", "fuelKind", "fuelPriceId", "id", "issueDate", "issuedById", "linkedRequestId", "litres", "meterReading", "meterReadingRecordId", "pricePerLitre", "readingType", "source", "totalCost" FROM "FuelIssue";
DROP TABLE "FuelIssue";
ALTER TABLE "new_FuelIssue" RENAME TO "FuelIssue";
CREATE UNIQUE INDEX "FuelIssue_linkedRequestId_key" ON "FuelIssue"("linkedRequestId");
CREATE UNIQUE INDEX "FuelIssue_meterReadingRecordId_key" ON "FuelIssue"("meterReadingRecordId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FuelIssueCorrection_status_projectCode_idx" ON "FuelIssueCorrection"("status", "projectCode");

-- CreateIndex
CREATE INDEX "FuelIssueCorrection_projectCode_createdAt_idx" ON "FuelIssueCorrection"("projectCode", "createdAt");

-- CreateIndex
CREATE INDEX "FuelIssueCorrection_fuelIssueId_idx" ON "FuelIssueCorrection"("fuelIssueId");
