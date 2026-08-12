-- Machines invoiced to the client outside this system (typically hired-in units
-- billed from the hire company's own invoice). Generating a bill for them here
-- would charge the client twice, so they are skipped entirely — no rental line,
-- no fuel line, no bill row. Distinct from billFuelOnly, which still bills fuel.
ALTER TABLE "Asset" ADD COLUMN "billExclude" BOOLEAN NOT NULL DEFAULT false;
