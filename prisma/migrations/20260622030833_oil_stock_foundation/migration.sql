-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Site_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sheetName" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'L',
    "category" TEXT,
    "reorderLevel" REAL,
    "unitPriceCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "txnDate" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "qtyReceived" REAL NOT NULL DEFAULT 0,
    "qtyIssued" REAL NOT NULL DEFAULT 0,
    "balanceAfter" REAL NOT NULL DEFAULT 0,
    "consumerType" TEXT,
    "assetId" TEXT,
    "projectId" TEXT,
    "siteId" TEXT,
    "description" TEXT,
    "mrNo" TEXT,
    "mtnNo" TEXT,
    "remark" TEXT,
    "serviceRecordId" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "importHash" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "bookQty" REAL NOT NULL DEFAULT 0,
    "countedQty" REAL NOT NULL DEFAULT 0,
    "variance" REAL NOT NULL DEFAULT 0,
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "countedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockCount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "projectId" TEXT,
    "siteId" TEXT,
    "qtyRequested" REAL,
    "qtySent" REAL,
    "qtyReceived" REAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txnId" TEXT,
    "note" TEXT,
    "rejectReason" TEXT,
    "discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "receivedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    CONSTRAINT "Requisition_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "StockMovement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Battery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleNo" TEXT NOT NULL,
    "vehicleNoNorm" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "serialNoNorm" TEXT NOT NULL,
    "note" TEXT,
    "photoData" BLOB NOT NULL,
    "photoMime" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Battery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BatteryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batteryId" TEXT,
    "action" TEXT NOT NULL,
    "serialNo" TEXT,
    "serialNoNorm" TEXT,
    "vehicleNo" TEXT,
    "fromVehicleNo" TEXT,
    "reason" TEXT,
    "photoData" BLOB,
    "photoMime" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatteryEvent_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "Battery" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BatteryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsumerAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawText" TEXT NOT NULL,
    "rawNorm" TEXT NOT NULL,
    "targetType" TEXT,
    "assetId" TEXT,
    "projectId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConsumerAlias_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ConsumerAlias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Site_projectId_idx" ON "Site"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_projectId_nameNorm_key" ON "Site"("projectId", "nameNorm");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_importHash_key" ON "StockMovement"("importHash");

-- CreateIndex
CREATE INDEX "StockMovement_productId_txnDate_idx" ON "StockMovement"("productId", "txnDate");

-- CreateIndex
CREATE INDEX "StockMovement_assetId_idx" ON "StockMovement"("assetId");

-- CreateIndex
CREATE INDEX "StockMovement_projectId_idx" ON "StockMovement"("projectId");

-- CreateIndex
CREATE INDEX "StockMovement_txnDate_idx" ON "StockMovement"("txnDate");

-- CreateIndex
CREATE INDEX "StockMovement_serviceRecordId_idx" ON "StockMovement"("serviceRecordId");

-- CreateIndex
CREATE INDEX "StockCount_period_idx" ON "StockCount"("period");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_productId_period_key" ON "StockCount"("productId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Requisition_txnId_key" ON "Requisition"("txnId");

-- CreateIndex
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");

-- CreateIndex
CREATE INDEX "Requisition_projectId_idx" ON "Requisition"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_vehicleNoNorm_key" ON "Battery"("vehicleNoNorm");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_serialNoNorm_key" ON "Battery"("serialNoNorm");

-- CreateIndex
CREATE INDEX "BatteryEvent_serialNoNorm_idx" ON "BatteryEvent"("serialNoNorm");

-- CreateIndex
CREATE INDEX "BatteryEvent_batteryId_idx" ON "BatteryEvent"("batteryId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumerAlias_rawNorm_key" ON "ConsumerAlias"("rawNorm");

-- CreateIndex
CREATE INDEX "ConsumerAlias_resolved_idx" ON "ConsumerAlias"("resolved");
