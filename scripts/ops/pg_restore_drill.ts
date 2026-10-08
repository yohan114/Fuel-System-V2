// PostgreSQL Restore Drill & Post-Restore Integrity Verification (Task OPS-01 / Wave C & E)
// Target: PostgreSQL 16+ LTS
// Reference: Master Plan Section 11 (Migration Runbook: Step 12) & Section 13 (Release Gates)

export interface RestoreOptions {
  host?: string;
  port?: number;
  targetDatabase?: string;
  username?: string;
  jobs?: number; // Parallel restore jobs
}

export interface RestoreDrillVerificationResult {
  allTablesPresent: boolean;
  tableCount: number;
  missingTables: string[];
  stockBalanceIntegrityPassed: boolean;
  volumeIntegrityPassed: boolean;
  financialTotalsIntegrityPassed: boolean;
  auditTrailContinuityPassed: boolean;
  rlsPoliciesActive: boolean;
  overallStatus: "PASSED" | "FAILED";
  discrepancies: string[];
}

export const EXPECTED_ERP_TABLES = [
  "projects",
  "categories",
  "pm_tasks",
  "assets",
  "asset_assignments",
  "vehicle_allocations",
  "fuel_prices",
  "fuel_requests",
  "fuel_issues",
  "fuel_issue_corrections",
  "meter_readings",
  "meter_outages",
  "audit_logs",
  "settings",
  "billing_site_overrides",
  "daily_conditions",
  "bulk_tanks",
  "tank_dips",
  "bulk_requests",
  "rental_rates",
  "bills",
  "bill_revisions",
  "invoice_counters",
  "payments",
  "bill_line_items",
  "budgets",
  "credit_notes",
  "service_intervals",
  "service_records",
  "service_items",
  "lubricants",
  "service_attachments",
  "filters",
  "filter_cross_refs",
  "asset_filters",
  "api_keys",
  "users",
];

/**
 * Builds the pg_restore command arguments to restore a custom-format dump into a target database.
 */
export function buildPgRestoreCommand(
  archiveFilePath: string,
  options: RestoreOptions = {}
): string[] {
  const host = options.host || process.env.PGHOST || "localhost";
  const port = options.port || Number(process.env.PGPORT) || 5432;
  const targetDb = options.targetDatabase || "fuelsystem_restore_drill";
  const user = options.username || process.env.PGUSER || "fuelsystem_migrator";
  const jobs = options.jobs || 2;

  return [
    "pg_restore",
    "-h", host,
    "-p", port.toString(),
    "-U", user,
    "-d", targetDb,
    "--clean",          // Clean (drop) database objects before recreating them
    "--if-exists",      // Don't error if drop targets do not exist
    "--no-owner",       // Do not set ownership of objects to match the original dump
    "--role=fuelsystem_migrator",
    "-j", jobs.toString(), // Multi-worker parallel restore
    "--verbose",
    archiveFilePath,
  ];
}

/**
 * Validates the referential, stock, billing, and schema integrity of a restored database.
 */
export function evaluateRestoredDatabaseState(
  existingTableNames: string[],
  tankBalances: Array<{ id: string; name: string; balance: number }>,
  negativeVolumeCount: number,
  unbalancedBillCount: number,
  auditLogCount: number,
  rlsTableCount: number
): RestoreDrillVerificationResult {
  const discrepancies: string[] = [];

  // 1. Schema Completeness: all 37 tables present
  const missingTables = EXPECTED_ERP_TABLES.filter(
    (t) => !existingTableNames.includes(t.toLowerCase())
  );
  if (missingTables.length > 0) {
    discrepancies.push(`Missing tables after restore: ${missingTables.join(", ")}`);
  }

  // 2. Physical Stock Balance Invariant (no negative tank balances)
  const negativeTanks = tankBalances.filter((t) => t.balance < 0);
  const stockBalanceIntegrityPassed = negativeTanks.length === 0;
  if (!stockBalanceIntegrityPassed) {
    discrepancies.push(
      `Detected ${negativeTanks.length} tanks with negative balances: ${negativeTanks.map((t) => t.name).join(", ")}`
    );
  }

  // 3. Issue Volume Positive Quantity Invariant
  const volumeIntegrityPassed = negativeVolumeCount === 0;
  if (!volumeIntegrityPassed) {
    discrepancies.push(`Detected ${negativeVolumeCount} active fuel issues with non-positive volume`);
  }

  // 4. Financial Integrity: Bill totals match line items
  const financialTotalsIntegrityPassed = unbalancedBillCount === 0;
  if (!financialTotalsIntegrityPassed) {
    discrepancies.push(`Detected ${unbalancedBillCount} bills with unbalanced line item math`);
  }

  // 5. Audit Trail Continuity
  const auditTrailContinuityPassed = auditLogCount > 0;
  if (!auditTrailContinuityPassed) {
    discrepancies.push("Zero audit logs recovered in restored database");
  }

  // 6. RLS Policies Active
  const rlsPoliciesActive = rlsTableCount >= EXPECTED_ERP_TABLES.length - 7; // At least core domain tables
  if (!rlsPoliciesActive) {
    discrepancies.push(`Insufficient RLS coverage in restored database (${rlsTableCount} tables active)`);
  }

  const overallStatus = discrepancies.length === 0 ? "PASSED" : "FAILED";

  return {
    allTablesPresent: missingTables.length === 0,
    tableCount: existingTableNames.length,
    missingTables,
    stockBalanceIntegrityPassed,
    volumeIntegrityPassed,
    financialTotalsIntegrityPassed,
    auditTrailContinuityPassed,
    rlsPoliciesActive,
    overallStatus,
    discrepancies,
  };
}
