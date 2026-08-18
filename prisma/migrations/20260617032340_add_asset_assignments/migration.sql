-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "actualMeterUnits" REAL;
ALTER TABLE "Bill" ADD COLUMN "derivedEconUnits" REAL;
ALTER TABLE "Bill" ADD COLUMN "derivedStandardUnits" REAL;
ALTER TABLE "Bill" ADD COLUMN "fuelConsEconSnapshot" REAL;
ALTER TABLE "Bill" ADD COLUMN "fuelConsTypSnapshot" REAL;

-- AlterTable
ALTER TABLE "BillLineItem" ADD COLUMN "projectId" TEXT;
ALTER TABLE "BillLineItem" ADD COLUMN "projectName" TEXT;

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_startDate_idx" ON "AssetAssignment"("assetId", "startDate");

-- CreateIndex
CREATE INDEX "AssetAssignment_projectId_startDate_idx" ON "AssetAssignment"("projectId", "startDate");
