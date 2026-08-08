-- Machines the client settles direct with their owner: E&C invoices neither
-- rental nor fuel for them, though they are posted to sites and draw from site
-- pumps like any other. Nullable-with-default so existing rows keep billing.
ALTER TABLE "Asset" ADD COLUMN "billedDirect" BOOLEAN NOT NULL DEFAULT false;
