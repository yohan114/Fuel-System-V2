-- Performance indexes (Round 2) & User email uniqueness
--
-- MeterReading: hot lookups by assetId + readingDate / value in aggregate.ts & compute.ts
-- FuelIssue: covering index for voided = false queries across billing, reports, service
-- AssetAssignment: distinct lookup by projectId for site scoping
-- DailyCondition: cross-fleet breakdown queries filtered by logDate
-- User: unique constraint on email for forgot password / SMTP recipient reliability

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "MeterReading_assetId_readingDate_idx" ON "MeterReading"("assetId", "readingDate");
CREATE INDEX "MeterReading_assetId_value_idx" ON "MeterReading"("assetId", "value");
CREATE INDEX "FuelIssue_assetId_voided_issueDate_idx" ON "FuelIssue"("assetId", "voided", "issueDate");
CREATE INDEX "AssetAssignment_projectId_idx" ON "AssetAssignment"("projectId");
CREATE INDEX "DailyCondition_logDate_idx" ON "DailyCondition"("logDate");
