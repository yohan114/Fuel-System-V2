-- Records that an ADD is what flipped a machine to fuel-only, so undoing the
-- override puts that back too rather than leaving it billing quietly forever.
ALTER TABLE "BillingSiteOverride" ADD COLUMN "setFuelOnly" BOOLEAN NOT NULL DEFAULT false;
