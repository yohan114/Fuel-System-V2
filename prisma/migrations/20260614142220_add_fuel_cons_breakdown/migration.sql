-- AlterTable
ALTER TABLE "RentalRate" ADD COLUMN "fuelConsBasis" TEXT;
ALTER TABLE "RentalRate" ADD COLUMN "fuelConsEcon" REAL;
ALTER TABLE "RentalRate" ADD COLUMN "fuelConsTyp" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bill" (
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
    "derivedFromFuel" BOOLEAN NOT NULL DEFAULT false,
    "fuelConsMidRate" REAL,
    "breakdownDays" INTEGER NOT NULL DEFAULT 0,
    "breakdownDeductCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "generatedById" TEXT,
    CONSTRAINT "Bill_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bill_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Bill" ("actualUnits", "assetCode", "assetId", "assetLabel", "assetRegNo", "billableUnits", "billingMode", "closingMeter", "createdAt", "dueDate", "fuelCostCents", "fuelLitres", "generatedById", "grandTotalCents", "id", "invoiceNumber", "issuedDate", "minimumUnits", "month", "notes", "openingMeter", "paidAmountCents", "paidDate", "paymentNote", "paymentRef", "periodEnd", "periodKey", "periodStart", "projectCode", "projectId", "projectName", "rateBasis", "rateCents", "rentalAmountCents", "ssclCents", "ssclRate", "status", "subtotalCents", "updatedAt", "vatCents", "vatRate", "year") SELECT "actualUnits", "assetCode", "assetId", "assetLabel", "assetRegNo", "billableUnits", "billingMode", "closingMeter", "createdAt", "dueDate", "fuelCostCents", "fuelLitres", "generatedById", "grandTotalCents", "id", "invoiceNumber", "issuedDate", "minimumUnits", "month", "notes", "openingMeter", "paidAmountCents", "paidDate", "paymentNote", "paymentRef", "periodEnd", "periodKey", "periodStart", "projectCode", "projectId", "projectName", "rateBasis", "rateCents", "rentalAmountCents", "ssclCents", "ssclRate", "status", "subtotalCents", "updatedAt", "vatCents", "vatRate", "year" FROM "Bill";
DROP TABLE "Bill";
ALTER TABLE "new_Bill" RENAME TO "Bill";
CREATE UNIQUE INDEX "Bill_invoiceNumber_key" ON "Bill"("invoiceNumber");
CREATE INDEX "Bill_periodKey_status_idx" ON "Bill"("periodKey", "status");
CREATE INDEX "Bill_projectId_periodKey_idx" ON "Bill"("projectId", "periodKey");
CREATE UNIQUE INDEX "Bill_assetId_year_month_key" ON "Bill"("assetId", "year", "month");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
