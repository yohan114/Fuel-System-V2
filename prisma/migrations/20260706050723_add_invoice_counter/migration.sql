-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCounter_year_key" ON "InvoiceCounter"("year");

