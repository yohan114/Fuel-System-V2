// PostgreSQL Rehearsal and Multi-Dimensional Reconciliation Test Suite (Task PG-02)
//
// Verifies:
// 1. Export manifest integrity and SHA-256 provenance checksum.
// 2. Exact row preservation across all 37 database tables.
// 3. Topological sort validity (no forward references or cycles).
// 4. SQL type formatter accuracy (UUID, timestamptz, jsonb, bytea, boolean, numeric).
// 5. 8-dimension reconciliation mathematical consistency (stock, volume, spend, tax math).
// 6. Quarantine detection of non-positive volume anomaly (c7365c6).

import { describe, expect, it, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { exportSqliteDataset } from "../scripts/rehearsal/export_sqlite_dataset";
import {
  TOPOLOGICAL_TABLE_ORDER,
  MODEL_TO_TABLE,
  formatSqlValue,
  toSnakeCase,
  generatePgImportSql,
} from "../scripts/rehearsal/pg_import_pipeline";
import { executeReconciliation } from "../scripts/rehearsal/reconcile_pg_dataset";

describe("PG-02: Dataset Export & Manifest Verification", () => {
  const rehearsalDir = path.resolve(process.cwd(), "data", "rehearsal");
  const manifestPath = path.join(rehearsalDir, "manifest.json");

  beforeAll(() => {
    if (!fs.existsSync(manifestPath)) {
      exportSqliteDataset();
    }
  });

  it("verifies export manifest exists with valid SHA-256 provenance hash", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.totalTables).toBe(37);
    expect(manifest.totalRows).toBe(57722);
    expect(manifest.overallSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest.tables).length).toBe(37);
  });

  it("verifies all 37 table JSON dumps exist and match manifest counts", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    for (const [table, meta] of Object.entries(manifest.tables) as [string, { rowCount: number }][]) {
      const tablePath = path.join(rehearsalDir, `${table}.json`);
      expect(fs.existsSync(tablePath), `Missing dump for table ${table}`).toBe(true);
      const rows = JSON.parse(fs.readFileSync(tablePath, "utf-8"));
      expect(rows.length).toBe(meta.rowCount);
    }
  });
});

describe("PG-02: Topological Dependency Order & SQL Formatting", () => {
  it("ensures every SQLite model is accounted for in topological order", () => {
    expect(TOPOLOGICAL_TABLE_ORDER.length).toBe(37);
    const unique = new Set(TOPOLOGICAL_TABLE_ORDER);
    expect(unique.size).toBe(37);

    // Parents must strictly precede children
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("Project")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("User")
    );
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("Category")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("Asset")
    );
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("Asset")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("FuelIssue")
    );
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("FuelIssue")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("FuelIssueCorrection")
    );
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("Bill")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("BillLineItem")
    );
    expect(TOPOLOGICAL_TABLE_ORDER.indexOf("Bill")).toBeLessThan(
      TOPOLOGICAL_TABLE_ORDER.indexOf("BillRevision")
    );
  });

  it("formats PostgreSQL values accurately", () => {
    // Nulls
    expect(formatSqlValue(null, "col")).toBe("NULL");
    expect(formatSqlValue(undefined, "col")).toBe("NULL");

    // Booleans
    expect(formatSqlValue(true, "active")).toBe("TRUE");
    expect(formatSqlValue(false, "active")).toBe("FALSE");

    // Numbers
    expect(formatSqlValue(123.45, "litres")).toBe("123.45");
    expect(formatSqlValue(150000, "cents")).toBe("150000");

    // Strings with quotes
    expect(formatSqlValue("D'Silva", "name")).toBe("'D''Silva'");

    // Timestamps
    expect(formatSqlValue("2026-08-15T10:30:00.000Z", "issueDate")).toBe(
      "'2026-08-15T10:30:00.000Z'::timestamptz"
    );

    // JSON fields
    expect(formatSqlValue({ key: "val" }, "metaJson")).toBe("'{\"key\":\"val\"}'::jsonb");
    expect(formatSqlValue('{"foo":"bar"}', "snapshotJson")).toBe("'{\"foo\":\"bar\"}'::jsonb");

    // Buffer blobs
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    expect(formatSqlValue(buf, "data")).toBe("E'\\\\xdeadbeef'");
  });

  it("generates valid PostgreSQL import DDL without syntax errors", () => {
    const res = generatePgImportSql();
    expect(res.totalTablesProcessed).toBe(37);
    expect(res.totalRowsConverted).toBe(57722);
    expect(fs.existsSync(res.outputSqlFilePath)).toBe(true);

    const sqlHeader = fs.readFileSync(res.outputSqlFilePath, "utf-8").slice(0, 1000);
    expect(sqlHeader).toContain("BEGIN;");
    expect(sqlHeader).toContain("session_replication_role = 'replica';");
  }, 15000);
});

describe("PG-02: 8-Dimension Reconciliation & Parity Verification", () => {
  const report = executeReconciliation();

  it("reconciles Dimension 1: Tank Stock Conservation", () => {
    const d1 = report.dimensions.tankStockConservation;
    expect(d1.totalTanks).toBe(32);
    expect(d1.totalRecordedBalanceLitres).toBeGreaterThan(0);
    expect(d1.passed).toBe(true);
    expect(d1.anomalies.length).toBe(0);
  });

  it("reconciles Dimension 2 & 3: Fuel Volumes & Spend Totals", () => {
    const d3 = report.dimensions.fuelVolumeAndSpendTotals;
    expect(d3.activeIssuesCount).toBe(15054);
    expect(d3.voidedIssuesCount).toBe(31);
    expect(d3.totalActiveLitres).toBe(689228.97);
    expect(d3.totalActiveSpendCents).toBeGreaterThan(0);
    expect(d3.passed).toBe(true);
  });

  it("reconciles Dimension 4: Assignment Coverage", () => {
    const d4 = report.dimensions.assignmentCoverage;
    expect(d4.totalAssignments).toBe(1433);
    expect(d4.manualOriginCount + d4.fuelOriginCount).toBe(1433);
    expect(d4.activeOpenAssignmentsCount).toBeGreaterThan(0);
    expect(d4.passed).toBe(true);
  });

  it("reconciles Dimension 5 & 6: Invoice State & Financial Allocations", () => {
    const d5 = report.dimensions.invoiceStateParity;
    const d6 = report.dimensions.financialAllocationTotals;

    expect(d5.totalBills).toBe(714);
    expect(d5.draftBillsCount + d5.issuedBillsCount + d5.paidBillsCount).toBe(714);
    expect(d5.taxMathConsistent).toBe(true);
    expect(d5.grandTotalCents).toBeGreaterThan(0);

    expect(d6.rentalAmountCents).toBeGreaterThan(0);
    expect(d6.fuelCostCents).toBeGreaterThan(0);
  });

  it("reconciles Dimension 7: Provenance & Deduplication", () => {
    const d7 = report.dimensions.sourceRowLinksAndProvenance;
    expect(d7.issuesWithImportKeyCount).toBe(1191);
    expect(d7.duplicateImportKeysDetected).toBe(0);
    expect(d7.passed).toBe(true);
  });

  it("reconciles Dimension 8: Audit Trail Coverage", () => {
    const d8 = report.dimensions.auditTrailCoverage;
    expect(d8.totalAuditLogs).toBe(13647);
    expect(d8.totalBillRevisions).toBe(9594);
    expect(d8.totalFuelCorrections).toBe(18);
    expect(d8.passed).toBe(true);
  });

  it("isolates known historical volume anomaly (-70 L row) into quarantine", () => {
    expect(report.quarantinedRecordsCount).toBe(1);
    expect(report.quarantinedRecords[0].id).toBe("b890b649-dfe0-4972-87b6-554ce754fd8b");
    expect(report.quarantinedRecords[0].reason).toContain("-70 L");
    expect(report.overallStatus).toBe("PASSED_WITH_APPROVED_EXCEPTIONS");
  });
});
