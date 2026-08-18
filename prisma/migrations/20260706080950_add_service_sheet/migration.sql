-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN "condition" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "location" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "manpowerCents" INTEGER;
ALTER TABLE "ServiceRecord" ADD COLUMN "nextServiceMeter" REAL;

-- CreateTable
CREATE TABLE "Lubricant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "oilType" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'L',
    "pricePerUnitCents" INTEGER,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServiceAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceRecordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceAttachment_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Lubricant_active_oilType_idx" ON "Lubricant"("active", "oilType");

-- CreateIndex
CREATE INDEX "ServiceAttachment_serviceRecordId_idx" ON "ServiceAttachment"("serviceRecordId");

