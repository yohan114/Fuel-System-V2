-- CreateTable
CREATE TABLE "ServiceOil" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceRecordId" TEXT NOT NULL,
    "oilName" TEXT NOT NULL,
    "oilType" TEXT,
    "actionType" TEXT,
    "quantity" REAL NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceOil_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceFilter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceRecordId" TEXT NOT NULL,
    "filterCategory" TEXT NOT NULL,
    "filterNo" TEXT,
    "actionType" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceFilter_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceCostLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceRecordId" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER NOT NULL DEFAULT 0,
    "qty" REAL NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceCostLine_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OilType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'L',
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "FilterCategoryRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "meterAtService" REAL,
    "meterType" TEXT NOT NULL,
    "serviceType" TEXT,
    "costCents" INTEGER,
    "note" TEXT,
    "jobNo" TEXT,
    "siteLocation" TEXT,
    "nextServiceMeter" REAL,
    "upkeepingStatus" TEXT,
    "repairDetails" TEXT,
    "partsSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "labourRatePct" REAL NOT NULL DEFAULT 0,
    "labourChargeCents" INTEGER NOT NULL DEFAULT 0,
    "sundryRatePct" REAL NOT NULL DEFAULT 0,
    "sundryAmountCents" INTEGER NOT NULL DEFAULT 0,
    "grandTotalCents" INTEGER NOT NULL DEFAULT 0,
    "recordedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ServiceRecord" ("assetId", "costCents", "createdAt", "id", "meterAtService", "meterType", "note", "recordedById", "serviceDate", "serviceType") SELECT "assetId", "costCents", "createdAt", "id", "meterAtService", "meterType", "note", "recordedById", "serviceDate", "serviceType" FROM "ServiceRecord";
DROP TABLE "ServiceRecord";
ALTER TABLE "new_ServiceRecord" RENAME TO "ServiceRecord";
CREATE INDEX "ServiceRecord_assetId_serviceDate_idx" ON "ServiceRecord"("assetId", "serviceDate");
CREATE INDEX "ServiceRecord_jobNo_idx" ON "ServiceRecord"("jobNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ServiceOil_serviceRecordId_idx" ON "ServiceOil"("serviceRecordId");

-- CreateIndex
CREATE INDEX "ServiceFilter_serviceRecordId_idx" ON "ServiceFilter"("serviceRecordId");

-- CreateIndex
CREATE INDEX "ServiceCostLine_serviceRecordId_idx" ON "ServiceCostLine"("serviceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "OilType_name_key" ON "OilType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FilterCategoryRef_name_key" ON "FilterCategoryRef"("name");
