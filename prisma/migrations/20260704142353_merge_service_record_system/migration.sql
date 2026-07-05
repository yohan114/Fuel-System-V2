-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN "jobNo" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "labourCents" INTEGER;
ALTER TABLE "ServiceRecord" ADD COLUMN "partsCents" INTEGER;
ALTER TABLE "ServiceRecord" ADD COLUMN "sourceRef" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "sundryCents" INTEGER;

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partNo" TEXT,
    "action" TEXT,
    "qty" REAL NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER,
    "amountCents" INTEGER,
    CONSTRAINT "ServiceItem_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Filter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT,
    "oemPartNo" TEXT,
    "hifiPartNo" TEXT,
    "description" TEXT,
    "priceCents" INTEGER,
    "priceNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FilterCrossRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filterId" TEXT NOT NULL,
    "brand" TEXT,
    "partNumber" TEXT NOT NULL,
    "normalizedPN" TEXT NOT NULL,
    "refType" TEXT,
    CONSTRAINT "FilterCrossRef_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Filter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetFilter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filterId" TEXT NOT NULL,
    "assetId" TEXT,
    "vehicleRef" TEXT NOT NULL,
    CONSTRAINT "AssetFilter_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Filter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetFilter_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceItem_serviceRecordId_idx" ON "ServiceItem"("serviceRecordId");

-- CreateIndex
CREATE INDEX "FilterCrossRef_normalizedPN_idx" ON "FilterCrossRef"("normalizedPN");

-- CreateIndex
CREATE INDEX "FilterCrossRef_filterId_idx" ON "FilterCrossRef"("filterId");

-- CreateIndex
CREATE INDEX "AssetFilter_assetId_idx" ON "AssetFilter"("assetId");

-- CreateIndex
CREATE INDEX "AssetFilter_filterId_idx" ON "AssetFilter"("filterId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRecord_sourceRef_key" ON "ServiceRecord"("sourceRef");

