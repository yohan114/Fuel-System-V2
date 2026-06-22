-- CreateTable
CREATE TABLE "FilterStockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "normalizedCode" TEXT NOT NULL,
    "filterNo" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "unitCostCents" INTEGER,
    "balanceAfter" INTEGER NOT NULL,
    "serviceRecordId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FilterStockMovement_normalizedCode_createdAt_idx" ON "FilterStockMovement"("normalizedCode", "createdAt");

-- CreateIndex
CREATE INDEX "FilterStockMovement_serviceRecordId_idx" ON "FilterStockMovement"("serviceRecordId");
