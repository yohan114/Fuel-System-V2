// ============================================================================
// PG-02 Rehearsal: PostgreSQL Data Import Pipeline & DDL Generator
// Generates dependency-ordered, type-converted SQL import statements from JSON snapshots
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// Mapping from Prisma Model / SQLite Table Name to PostgreSQL Table Name
export const MODEL_TO_TABLE: Record<string, string> = {
  Setting: "settings",
  Project: "projects",
  Category: "categories",
  BulkTank: "bulk_tanks",
  User: "users",
  Asset: "assets",
  PMTask: "pm_tasks",
  AssetAssignment: "asset_assignments",
  VehicleAllocation: "vehicle_allocations",
  FuelPrice: "fuel_prices",
  FuelRequest: "fuel_requests",
  BulkRequest: "bulk_requests",
  TankDip: "tank_dips",
  FuelIssue: "fuel_issues",
  MeterReading: "meter_readings",
  MeterOutage: "meter_outages",
  DailyCondition: "daily_conditions",
  RentalRate: "rental_rates",
  Bill: "bills",
  BillRevision: "bill_revisions",
  InvoiceCounter: "invoice_counters",
  Payment: "payments",
  BillLineItem: "bill_line_items",
  Budget: "budgets",
  CreditNote: "credit_notes",
  ServiceInterval: "service_intervals",
  ServiceRecord: "service_records",
  ServiceItem: "service_items",
  Lubricant: "lubricants",
  ServiceAttachment: "service_attachments",
  Filter: "filters",
  FilterCrossRef: "filter_cross_refs",
  AssetFilter: "asset_filters",
  ApiKey: "api_keys",
  FuelIssueCorrection: "fuel_issue_corrections",
  BillingSiteOverride: "billing_site_overrides",
  AuditLog: "audit_logs",
};

// Strict topological dependency order ensuring parents precede children
export const TOPOLOGICAL_TABLE_ORDER: string[] = [
  "Setting",
  "Project",
  "Category",
  "BulkTank",
  "User",
  "Asset",
  "PMTask",
  "AssetAssignment",
  "VehicleAllocation",
  "FuelPrice",
  "FuelRequest",
  "BulkRequest",
  "TankDip",
  "FuelIssue",
  "MeterReading",
  "MeterOutage",
  "DailyCondition",
  "RentalRate",
  "Bill",
  "BillRevision",
  "InvoiceCounter",
  "Payment",
  "BillLineItem",
  "Budget",
  "CreditNote",
  "ServiceInterval",
  "ServiceRecord",
  "ServiceItem",
  "Lubricant",
  "ServiceAttachment",
  "Filter",
  "FilterCrossRef",
  "AssetFilter",
  "ApiKey",
  "FuelIssueCorrection",
  "BillingSiteOverride",
  "AuditLog",
];

// Helper to convert camelCase to snake_case for PostgreSQL column names
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
}

// Converts a JavaScript / SQLite scalar value into a PostgreSQL SQL literal
export function formatSqlValue(val: any, colName: string): string {
  if (val === null || val === undefined) {
    return "NULL";
  }

  if (typeof val === "boolean") {
    return val ? "TRUE" : "FALSE";
  }

  if (typeof val === "number") {
    if (isNaN(val)) return "NULL";
    return val.toString();
  }

  // Handle byte blobs (Buffer / Uint8Array)
  if (Buffer.isBuffer(val) || (typeof val === "object" && val.type === "Buffer")) {
    const bytes = Buffer.isBuffer(val) ? val : Buffer.from(val.data);
    return `E'\\\\x${bytes.toString("hex")}'`;
  }

  if (typeof val === "string") {
    // Escape single quotes for SQL
    const escaped = val.replace(/'/g, "''");

    // Check if column is a JSON field
    if (
      colName.toLowerCase().endsWith("json") ||
      colName === "metaJson" ||
      colName === "snapshotJson"
    ) {
      return `'${escaped}'::jsonb`;
    }

    // Check if string is an ISO timestamp
    if (/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}:\d{2}/.test(val)) {
      return `'${escaped}'::timestamptz`;
    }

    return `'${escaped}'`;
  }

  if (typeof val === "object") {
    const jsonStr = JSON.stringify(val).replace(/'/g, "''");
    return `'${jsonStr}'::jsonb`;
  }

  return `'${String(val).replace(/'/g, "''")}'`;
}

export interface PipelineResult {
  totalTablesProcessed: number;
  totalRowsConverted: number;
  quarantinedRowsCount: number;
  quarantineReport: Array<{ table: string; id: string; reason: string }>;
  outputSqlFilePath: string;
}

export function generatePgImportSql(
  stagingDir: string = path.resolve(process.cwd(), "data", "rehearsal"),
  outputSqlPath: string = path.resolve(
    process.cwd(),
    "scripts",
    "migrations",
    "pg",
    "002_rehearsal_data_import.sql"
  )
): PipelineResult {
  const manifestPath = path.join(stagingDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Staging manifest not found at ${manifestPath}. Run export_sqlite_dataset first.`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const outDir = path.dirname(outputSqlPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const fd = fs.openSync(outputSqlPath, "w");
  let writeBuffer: string[] = [];

  function flushBuffer() {
    if (writeBuffer.length > 0) {
      fs.writeSync(fd, writeBuffer.join(""));
      writeBuffer = [];
    }
  }

  function write(chunk: string) {
    writeBuffer.push(chunk);
    if (writeBuffer.length >= 1000) {
      flushBuffer();
    }
  }

  write("-- ============================================================================\n");
  write("-- PostgreSQL Rehearsal Data Import Script (Task PG-02 / Wave C)\n");
  write(`-- Source: ${manifest.sourceDbPath}\n`);
  write(`-- Exported At: ${manifest.exportedAt}\n`);
  write(`-- Source SHA-256: ${manifest.overallSha256}\n`);
  write("-- ============================================================================\n\n");
  write("BEGIN;\n\n");
  write("-- Disable FK trigger checks temporarily for fast bulk load\n");
  write("SET session_replication_role = 'replica';\n\n");

  let totalRows = 0;
  const quarantineReport: Array<{ table: string; id: string; reason: string }> = [];

  for (const modelName of TOPOLOGICAL_TABLE_ORDER) {
    const jsonFile = path.join(stagingDir, `${modelName}.json`);
    if (!fs.existsSync(jsonFile)) continue;

    const rows: Record<string, any>[] = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    const targetTable = MODEL_TO_TABLE[modelName] || toSnakeCase(modelName);

    if (rows.length === 0) {
      write(`-- Table: ${targetTable} (0 rows)\n\n`);
      continue;
    }

    write(`-- Table: ${targetTable} (${rows.length} rows)\n`);

    const colNames = Object.keys(rows[0]);
    const pgColNames = colNames.map(toSnakeCase);

    for (const row of rows) {
      // Validate domain invariants for quarantine
      if (modelName === "BulkTank" && row.balance < 0) {
        quarantineReport.push({
          table: modelName,
          id: row.id,
          reason: `Negative tank balance detected (${row.balance} L)`,
        });
      }

      if (modelName === "FuelIssue" && row.litres <= 0) {
        quarantineReport.push({
          table: modelName,
          id: row.id,
          reason: `Non-positive fuel volume detected (${row.litres} L)`,
        });
      }

      const values = colNames.map((col) => formatSqlValue(row[col], col));
      write(
        `INSERT INTO ${targetTable} (${pgColNames.join(", ")}) VALUES (${values.join(", ")});\n`
      );
      totalRows++;
    }

    write("\n");
  }

  // Restore triggers & sync sequences
  write("SET session_replication_role = 'origin';\n\n");
  write("-- Reset serial sequence counters\n");
  write(
    "SELECT setval('invoice_counters_id_seq', (SELECT COALESCE(MAX(id), 1) FROM invoice_counters));\n\n"
  );
  write("COMMIT;\n");

  flushBuffer();
  fs.closeSync(fd);

  return {
    totalTablesProcessed: TOPOLOGICAL_TABLE_ORDER.length,
    totalRowsConverted: totalRows,
    quarantinedRowsCount: quarantineReport.length,
    quarantineReport,
    outputSqlFilePath: outputSqlPath,
  };
}

// Direct execution CLI entrypoint
if (require.main === module || process.argv[1]?.includes("pg_import_pipeline")) {
  console.log("=== GENERATING POSTGRESQL IMPORT SCRIPT FOR PG-02 REHEARSAL ===");
  const res = generatePgImportSql();
  console.log(`Tables Processed:    ${res.totalTablesProcessed}`);
  console.log(`Total Rows Converted: ${res.totalRowsConverted}`);
  console.log(`Quarantined Rows:    ${res.quarantinedRowsCount}`);
  console.log(`Output SQL Script:   ${res.outputSqlFilePath}`);
  if (res.quarantinedRowsCount > 0) {
    console.log("Quarantine items:");
    console.log(JSON.stringify(res.quarantineReport, null, 2));
  }
}
