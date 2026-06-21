-- AlterTable
ALTER TABLE "FuelIssue" ADD COLUMN "photoData" BLOB;
ALTER TABLE "FuelIssue" ADD COLUMN "photoMime" TEXT;
ALTER TABLE "FuelIssue" ADD COLUMN "photoName" TEXT;

-- AlterTable
ALTER TABLE "FuelRequest" ADD COLUMN "photoData" BLOB;
ALTER TABLE "FuelRequest" ADD COLUMN "photoMime" TEXT;
ALTER TABLE "FuelRequest" ADD COLUMN "photoName" TEXT;

-- CreateTable
CREATE TABLE "TankDip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bulkTankId" TEXT NOT NULL,
    "dipLitres" REAL NOT NULL,
    "computedBalance" REAL NOT NULL,
    "variance" REAL NOT NULL,
    "dipDate" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    CONSTRAINT "TankDip_bulkTankId_fkey" FOREIGN KEY ("bulkTankId") REFERENCES "BulkTank" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TankDip_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TankDip_bulkTankId_dipDate_idx" ON "TankDip"("bulkTankId", "dipDate");
