-- CreateTable
CREATE TABLE "ServiceInterval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT,
    "assetId" TEXT,
    "basis" TEXT NOT NULL,
    "intervalValue" REAL NOT NULL,
    "intervalMonths" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceInterval_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceInterval_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "meterAtService" REAL,
    "meterType" TEXT NOT NULL,
    "serviceType" TEXT,
    "costCents" INTEGER,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInterval_categoryId_key" ON "ServiceInterval"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInterval_assetId_key" ON "ServiceInterval"("assetId");

-- CreateIndex
CREATE INDEX "ServiceRecord_assetId_serviceDate_idx" ON "ServiceRecord"("assetId", "serviceDate");
