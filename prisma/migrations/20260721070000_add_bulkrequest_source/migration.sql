-- Bulk replenishment requests carry a fuel source: an outside supplier
-- purchase (delivery), or a transfer from another site's tank.
ALTER TABLE "BulkRequest" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'OUTSIDE';
ALTER TABLE "BulkRequest" ADD COLUMN "sourceTankId" TEXT;
