-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN "sourceRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRecord_sourceRef_key" ON "ServiceRecord"("sourceRef");
