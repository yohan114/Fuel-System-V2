-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "estimatedMeterDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MeterOutage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT,
    "endDate" DATETIME,
    "endPhysicalMeter" REAL,
    "instrumentContinuity" TEXT,
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeterOutage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeterOutage_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeterOutage_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MeterOutage_assetId_startDate_idx" ON "MeterOutage"("assetId", "startDate");

-- Unique partial index: At most one open outage per asset at a time
CREATE UNIQUE INDEX IF NOT EXISTS "MeterOutage_assetId_open_unique" ON "MeterOutage"("assetId") WHERE "endDate" IS NULL;
