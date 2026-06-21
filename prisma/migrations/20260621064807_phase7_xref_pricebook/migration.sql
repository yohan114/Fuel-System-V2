-- CreateTable
CREATE TABLE "FilterCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" INTEGER,
    "filterCategory" TEXT,
    "oemPartNumber" TEXT,
    "hifiPartNumber" TEXT,
    "description" TEXT,
    "compatibleFleet" TEXT,
    "crossRefText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FilterCrossRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "partNumber" TEXT NOT NULL,
    "normalizedPN" TEXT NOT NULL,
    "refType" TEXT NOT NULL DEFAULT 'cross',
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FilterCrossRef_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "FilterCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FilterVehicleLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "ec" TEXT NOT NULL,
    CONSTRAINT "FilterVehicleLink_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "FilterCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FilterPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierCode" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "totalPriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OilPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterCatalog_sourceId_key" ON "FilterCatalog"("sourceId");

-- CreateIndex
CREATE INDEX "FilterCatalog_filterCategory_idx" ON "FilterCatalog"("filterCategory");

-- CreateIndex
CREATE INDEX "FilterCrossRef_normalizedPN_idx" ON "FilterCrossRef"("normalizedPN");

-- CreateIndex
CREATE INDEX "FilterCrossRef_catalogId_idx" ON "FilterCrossRef"("catalogId");

-- CreateIndex
CREATE INDEX "FilterCrossRef_brand_idx" ON "FilterCrossRef"("brand");

-- CreateIndex
CREATE INDEX "FilterVehicleLink_catalogId_idx" ON "FilterVehicleLink"("catalogId");

-- CreateIndex
CREATE INDEX "FilterVehicleLink_ec_idx" ON "FilterVehicleLink"("ec");

-- CreateIndex
CREATE INDEX "FilterPrice_normalizedCode_idx" ON "FilterPrice"("normalizedCode");

-- CreateIndex
CREATE UNIQUE INDEX "OilPrice_code_key" ON "OilPrice"("code");
