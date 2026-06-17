-- CreateTable
CREATE TABLE "RentalRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "category" TEXT,
    "equipType" TEXT NOT NULL DEFAULT 'FLEET',
    "fuelQtyDefault" REAL,
    "opRate" INTEGER,
    "hrFwCents" INTEGER,
    "hrWCents" INTEGER,
    "hrDCents" INTEGER,
    "dyFwCents" INTEGER,
    "dyWCents" INTEGER,
    "dyDCents" INTEGER,
    "kmFwCents" INTEGER,
    "kmWCents" INTEGER,
    "kmDCents" INTEGER,
    "portDwCents" INTEGER,
    "portDdCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RentalRate_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetRegNo" TEXT,
    "assetLabel" TEXT,
    "projectId" TEXT,
    "projectName" TEXT,
    "projectCode" TEXT,
    "billingMode" TEXT NOT NULL,
    "rateBasis" TEXT NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "openingMeter" REAL,
    "closingMeter" REAL,
    "actualUnits" REAL NOT NULL,
    "minimumUnits" REAL NOT NULL,
    "billableUnits" REAL NOT NULL,
    "rentalAmountCents" INTEGER NOT NULL,
    "fuelLitres" REAL NOT NULL DEFAULT 0,
    "fuelCostCents" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL,
    "ssclRate" REAL NOT NULL,
    "ssclCents" INTEGER NOT NULL,
    "vatRate" REAL NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "grandTotalCents" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issuedDate" DATETIME,
    "dueDate" DATETIME,
    "paidDate" DATETIME,
    "paidAmountCents" INTEGER,
    "paymentRef" TEXT,
    "paymentNote" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "generatedById" TEXT,
    CONSTRAINT "Bill_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bill_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "unitRateCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "BillLineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalRate_assetId_key" ON "RentalRate"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_invoiceNumber_key" ON "Bill"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Bill_periodKey_status_idx" ON "Bill"("periodKey", "status");

-- CreateIndex
CREATE INDEX "Bill_projectId_periodKey_idx" ON "Bill"("projectId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_assetId_year_month_key" ON "Bill"("assetId", "year", "month");

-- CreateIndex
CREATE INDEX "BillLineItem_billId_idx" ON "BillLineItem"("billId");
