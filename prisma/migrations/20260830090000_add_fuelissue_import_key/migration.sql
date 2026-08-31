-- Provenance for imported fuel issues.
--
-- importKey is sha1("<file>|<sheet>|<excelRow>|<projectCode>") — the identity of
-- the SHEET ROW, not of the values on it. A re-import of the same workbook is
-- then a no-op regardless of edits made between runs, and a changed litre figure
-- on a row already loaded surfaces as an update candidate rather than a second
-- charge.
--
-- Nullable and additive: every existing row keeps NULL, so nothing is rewritten
-- and no backfill is needed. SQLite treats NULLs as distinct under a UNIQUE
-- index, so the 13,000+ existing rows do not collide with each other.
ALTER TABLE "FuelIssue" ADD COLUMN "importKey" TEXT;

CREATE UNIQUE INDEX "FuelIssue_importKey_key" ON "FuelIssue"("importKey");
