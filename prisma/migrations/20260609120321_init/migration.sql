-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultMeterType" TEXT NOT NULL,
    "fleetGroup" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "brand" TEXT,
    "typeLabel" TEXT,
    "model" TEXT,
    "regNo" TEXT,
    "capacity" TEXT,
    "yom" INTEGER,
    "chassisNo" TEXT,
    "engineNo" TEXT,
    "serialNo" TEXT,
    "site" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "meterType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "categoryId" TEXT NOT NULL,
    CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelKind" TEXT NOT NULL,
    "pricePerLitre" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredById" TEXT NOT NULL,
    CONSTRAINT "FuelPrice_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelKind" TEXT NOT NULL,
    "requestedLitres" REAL NOT NULL,
    "meterReading" REAL,
    "readingType" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assetId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    CONSTRAINT "FuelRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fuelKind" TEXT NOT NULL,
    "litres" REAL NOT NULL,
    "meterReading" REAL,
    "readingType" TEXT,
    "pricePerLitre" INTEGER NOT NULL,
    "totalCost" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "fuelPriceId" TEXT,
    "linkedRequestId" TEXT,
    "meterReadingRecordId" TEXT,
    CONSTRAINT "FuelIssue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_fuelPriceId_fkey" FOREIGN KEY ("fuelPriceId") REFERENCES "FuelPrice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelIssue_linkedRequestId_fkey" FOREIGN KEY ("linkedRequestId") REFERENCES "FuelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" REAL NOT NULL,
    "readingType" TEXT NOT NULL,
    "readingDate" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "linkedIssueId" TEXT,
    CONSTRAINT "MeterReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeterReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeterReading_linkedIssueId_fkey" FOREIGN KEY ("linkedIssueId") REFERENCES "FuelIssue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE INDEX "FuelPrice_fuelKind_effectiveFrom_idx" ON "FuelPrice"("fuelKind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FuelPrice_fuelKind_effectiveFrom_key" ON "FuelPrice"("fuelKind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FuelIssue_linkedRequestId_key" ON "FuelIssue"("linkedRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelIssue_meterReadingRecordId_key" ON "FuelIssue"("meterReadingRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_linkedIssueId_key" ON "MeterReading"("linkedIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");
