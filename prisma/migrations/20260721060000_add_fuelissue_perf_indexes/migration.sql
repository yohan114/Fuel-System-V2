-- Performance indexes for the FuelIssue hot table.
-- FuelIssue is read by whole-fleet date range (reports) and per-vehicle
-- (billing/service), always filtering voided=false. Previously every such
-- query full-scanned the table; these indexes turn them into index searches.
CREATE INDEX "FuelIssue_assetId_issueDate_idx" ON "FuelIssue"("assetId", "issueDate");
CREATE INDEX "FuelIssue_issueDate_idx" ON "FuelIssue"("issueDate");
CREATE INDEX "FuelIssue_bulkTankId_idx" ON "FuelIssue"("bulkTankId");
