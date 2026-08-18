-- Dry/Wet bill support: driver + billing type on allocations, driver snapshot on bills.
ALTER TABLE "AssetAssignment" ADD COLUMN "driverName" TEXT;
ALTER TABLE "AssetAssignment" ADD COLUMN "billingType" TEXT;
ALTER TABLE "Bill" ADD COLUMN "driverName" TEXT;
