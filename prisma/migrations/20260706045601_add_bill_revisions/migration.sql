-- CreateTable
CREATE TABLE "BillRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "grandTotalCents" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillRevision_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BillRevision_billId_idx" ON "BillRevision"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "BillRevision_billId_revision_key" ON "BillRevision"("billId", "revision");

