-- Add an accountability "issue person" (responsible pump operator / site) to fuel issues.
ALTER TABLE "FuelIssue" ADD COLUMN "issuePerson" TEXT;
