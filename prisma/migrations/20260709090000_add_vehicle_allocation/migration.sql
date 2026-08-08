-- CreateTable
CREATE TABLE "VehicleAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "projectId" TEXT,
    "siteName" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "assetId" TEXT,
    "vehicleNo" TEXT NOT NULL,
    "machineType" TEXT,
    "ownerCode" TEXT,
    "basis" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VehicleAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VehicleAllocation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAllocation_dedupeKey_key" ON "VehicleAllocation"("dedupeKey");

-- CreateIndex
CREATE INDEX "VehicleAllocation_projectId_month_idx" ON "VehicleAllocation"("projectId", "month");

-- CreateIndex
CREATE INDEX "VehicleAllocation_assetId_month_idx" ON "VehicleAllocation"("assetId", "month");

-- CreateIndex
CREATE INDEX "VehicleAllocation_month_idx" ON "VehicleAllocation"("month");
