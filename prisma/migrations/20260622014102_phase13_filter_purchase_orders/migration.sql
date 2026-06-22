-- AlterTable
ALTER TABLE "FilterStockMovement" ADD COLUMN "purchaseOrderId" TEXT;

-- CreateTable
CREATE TABLE "FilterPurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplier" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderedAt" DATETIME,
    "receivedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FilterPurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "filterNo" TEXT,
    "category" TEXT,
    "qtyOrdered" INTEGER NOT NULL DEFAULT 0,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER,
    CONSTRAINT "FilterPurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "FilterPurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterPurchaseOrder_poNumber_key" ON "FilterPurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "FilterPurchaseOrderLine_purchaseOrderId_idx" ON "FilterPurchaseOrderLine"("purchaseOrderId");
