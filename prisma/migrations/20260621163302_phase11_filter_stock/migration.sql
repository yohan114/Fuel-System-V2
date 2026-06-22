-- CreateTable
CREATE TABLE "FilterStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "normalizedCode" TEXT NOT NULL,
    "filterNo" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterStock_normalizedCode_key" ON "FilterStock"("normalizedCode");
