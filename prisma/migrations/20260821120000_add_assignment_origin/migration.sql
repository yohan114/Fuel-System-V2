-- Where a site posting came from: "FUEL" (derived from fuel issues, rebuilt on
-- every run of apply-fuel-driven-attachment) or "MANUAL" (a person put the
-- vehicle there, and the rebuild must not touch it).
--
-- Every existing row is FUEL: the current table was written wholesale by the
-- fuel-driven rebuild, which deletes and rewrites the lot. Backfilling to FUEL
-- is therefore accurate, and it must happen before anything reads the column —
-- if rows defaulted to MANUAL the next rebuild would replace nothing.
ALTER TABLE "AssetAssignment" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'FUEL';

UPDATE "AssetAssignment" SET "origin" = 'FUEL';

CREATE INDEX "AssetAssignment_origin_idx" ON "AssetAssignment"("origin");
