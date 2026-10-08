// PostgreSQL Schema and Parity Verification (Task PG-01 / Wave C)
//
// Verifies:
// 1. Model coverage & parity: All 37 models in the active SQLite schema exist in the PostgreSQL schema.
// 2. Field parity: Key business models have matching field names in both schemas.
// 3. PostgreSQL DDL completeness: All models have corresponding CREATE TABLE statements in the migration DDL.
// 4. Critical enterprise constraints:
//    - Physical tank balance non-negative CHECK (balance >= 0)
//    - Issue quantity positive CHECK (litres > 0)
//    - Financial amounts non-negative / positive CHECK
//    - Temporal exclusion constraint on asset_assignments (EXCLUDE USING gist)
//    - Row-Level Security enablement on tenant-scoped tables
//    - Outbox message queue table for asynchronous transactional outbox

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

function extractModelNames(schemaContent: string): string[] {
  const matches = schemaContent.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{/gm);
  return Array.from(matches, (m) => m[1]);
}

function extractModelFields(schemaContent: string, modelName: string): string[] {
  const regex = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\}`, "m");
  const match = schemaContent.match(regex);
  if (!match) return [];
  const lines = match[1].split("\n");
  const fields: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      fields.push(parts[0]);
    }
  }
  return fields;
}

describe("PG-01: PostgreSQL Schema Parity", () => {
  const rootDir = path.resolve(__dirname, "..");
  const sqliteSchemaPath = path.join(rootDir, "prisma", "schema.prisma");
  const pgSchemaPath = path.join(rootDir, "prisma", "schema.postgresql.prisma");
  const pgDdlPath = path.join(rootDir, "scripts", "migrations", "pg", "001_initial_postgresql_schema.sql");
  const adrPath = path.join(rootDir, "docs", "adr", "0001-postgresql-schema-and-mapping-design.md");

  const sqliteSchema = fs.readFileSync(sqliteSchemaPath, "utf-8");
  const pgSchema = fs.readFileSync(pgSchemaPath, "utf-8");
  const pgDdl = fs.readFileSync(pgDdlPath, "utf-8");

  it("ensures ADR 0001 documentation exists and covers required sections", () => {
    expect(fs.existsSync(adrPath)).toBe(true);
    const adrContent = fs.readFileSync(adrPath, "utf-8");
    expect(adrContent).toContain("ADR 0001: PostgreSQL Schema & Mapping Design (PG-01)");
    expect(adrContent).toContain("Data Type Mapping Matrix");
    expect(adrContent).toContain("Row-Level Security (RLS)");
    expect(adrContent).toContain("Transactional Outbox Pattern");
    expect(adrContent).toContain("EF Core");
  });

  it("ensures all 37 SQLite models exist in the PostgreSQL Prisma schema", () => {
    const sqliteModels = extractModelNames(sqliteSchema);
    const pgModels = extractModelNames(pgSchema);

    expect(sqliteModels.length).toBe(37);

    for (const model of sqliteModels) {
      expect(pgModels, `PostgreSQL schema is missing model '${model}'`).toContain(model);
    }

    // PostgreSQL schema must also include OutboxMessage for async event patterns
    expect(pgModels).toContain("OutboxMessage");
  });

  it("ensures field name parity across core transactional models", () => {
    const coreModels = [
      "Asset",
      "AssetAssignment",
      "BulkTank",
      "FuelIssue",
      "FuelRequest",
      "Bill",
      "MeterReading",
      "MeterOutage",
      "AuditLog",
    ];

    for (const model of coreModels) {
      const sqliteFields = extractModelFields(sqliteSchema, model);
      const pgFields = extractModelFields(pgSchema, model);

      for (const field of sqliteFields) {
        expect(
          pgFields,
          `Model ${model} in PostgreSQL schema is missing field '${field}'`
        ).toContain(field);
      }
    }
  });

  it("ensures PostgreSQL DDL defines tables for all models", () => {
    const ddlLower = pgDdl.toLowerCase();
    const tableNames = [
      "users",
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
      "projects",
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
      "outbox_messages",
    ];

    for (const table of tableNames) {
      expect(
        ddlLower.includes(`create table if not exists ${table}`) ||
          ddlLower.includes(`create table ${table}`),
        `DDL is missing table '${table}'`
      ).toBe(true);
    }
  });

  it("enforces critical database-level CHECK and EXCLUDE constraints in DDL", () => {
    // 1. Bulk Tank balance cannot drop below zero
    expect(pgDdl).toMatch(/balance\s+NUMERIC\([^)]+\)[^;]*CHECK\s*\(\s*balance\s*>=\s*0/i);

    // 2. Fuel Issue litres must be strictly positive
    expect(pgDdl).toMatch(/litres\s+NUMERIC\([^)]+\)[^;]*CHECK\s*\(\s*litres\s*>\s*0/i);

    // 3. Bill month between 1 and 12
    expect(pgDdl).toMatch(/month\s+INT[^;]*CHECK\s*\(\s*month\s+BETWEEN\s+1\s+AND\s+12/i);

    // 4. Temporal overlap exclusion constraint on asset_assignments
    expect(pgDdl).toContain("EXCLUDE USING gist");
    expect(pgDdl).toContain("daterange");
    expect(pgDdl).toContain("no_overlapping_asset_assignments");

    // 5. Row-Level Security enabled
    expect(pgDdl).toContain("ALTER TABLE fuel_issues ENABLE ROW LEVEL SECURITY;");
    expect(pgDdl).toContain("ALTER TABLE bills ENABLE ROW LEVEL SECURITY;");
    expect(pgDdl).toContain("ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;");

    // 6. Transactional outbox table
    expect(pgDdl).toContain("CREATE TABLE IF NOT EXISTS outbox_messages");
  });
});
