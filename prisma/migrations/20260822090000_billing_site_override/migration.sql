-- A hand-made decision about one vehicle on one site's bill for one month.
-- Kept as its own record rather than an edited posting or draft, because both
-- of those are rebuilt from the source data and would erase it.
CREATE TABLE "BillingSiteOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingSiteOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingSiteOverride_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingSiteOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BillingSiteOverride_periodKey_projectId_idx" ON "BillingSiteOverride"("periodKey", "projectId");
CREATE INDEX "BillingSiteOverride_assetId_periodKey_idx" ON "BillingSiteOverride"("assetId", "periodKey");
CREATE UNIQUE INDEX "BillingSiteOverride_projectId_periodKey_assetId_key" ON "BillingSiteOverride"("projectId", "periodKey", "assetId");
