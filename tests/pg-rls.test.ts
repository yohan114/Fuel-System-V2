// PostgreSQL Row-Level Security (RLS) & Role Hardening Test Suite (Task RLS-01)
//
// Verifies:
// 1. Role Segregation: fuelsystem_migrator (DDL) and fuelsystem_app (least-privilege DML).
// 2. FORCE ROW LEVEL SECURITY applied across all tenant and transactional tables.
// 3. Helper functions: rls_is_admin, rls_current_role, rls_current_project_id, rls_current_tank_id.
// 4. Policy rules:
//    - fuel_issues: site/tank scoped, hard DELETE restricted to ADMIN.
//    - bills: WORKSHOP and SITE_PUMP denied at database level (SEC-02 parity).
//    - audit_logs: append-only immutability (UPDATE and DELETE unconditionally rejected).
// 5. Connection pool hygiene: withTenantContext, buildSetLocalSql, and session reset.
// 6. ADR 0002 architectural compliance.

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildSetLocalSql,
  buildResetSessionSql,
  withTenantContext,
  TenantSessionContext,
  PgQueryExecutor,
} from "../src/lib/db/pg-context";

describe("RLS-01: PostgreSQL Roles and DDL Verification", () => {
  const rootDir = path.resolve(__dirname, "..");
  const rlsMigrationPath = path.join(
    rootDir,
    "scripts",
    "migrations",
    "pg",
    "003_row_level_security.sql"
  );
  const adrPath = path.join(
    rootDir,
    "docs",
    "adr",
    "0002-postgresql-row-level-security-and-roles.md"
  );

  const rlsSql = fs.readFileSync(rlsMigrationPath, "utf-8");

  it("verifies ADR 0002 documentation exists and covers all required sections", () => {
    expect(fs.existsSync(adrPath)).toBe(true);
    const adr = fs.readFileSync(adrPath, "utf-8");
    expect(adr).toContain("ADR 0002: PostgreSQL Row-Level Security (RLS)");
    expect(adr).toContain("fuelsystem_migrator");
    expect(adr).toContain("fuelsystem_app");
    expect(adr).toContain("FORCE ROW LEVEL SECURITY");
    expect(adr).toContain("Connection Pool Hygiene");
  });

  it("defines segregated database roles for schema owner and runtime application", () => {
    // Schema migrator role
    expect(rlsSql).toContain("CREATE ROLE fuelsystem_migrator");
    expect(rlsSql).toContain("GRANT ALL PRIVILEGES ON SCHEMA public TO fuelsystem_migrator");

    // Runtime application role with revoked DDL
    expect(rlsSql).toContain("CREATE ROLE fuelsystem_app");
    expect(rlsSql).toContain("REVOKE CREATE ON SCHEMA public FROM fuelsystem_app;");
    expect(rlsSql).toContain("GRANT USAGE ON SCHEMA public TO fuelsystem_app;");
    expect(rlsSql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fuelsystem_app;");
  });

  it("defines context evaluation helper functions", () => {
    expect(rlsSql).toContain("CREATE OR REPLACE FUNCTION rls_is_admin()");
    expect(rlsSql).toContain("CREATE OR REPLACE FUNCTION rls_current_role()");
    expect(rlsSql).toContain("CREATE OR REPLACE FUNCTION rls_current_project_id()");
    expect(rlsSql).toContain("CREATE OR REPLACE FUNCTION rls_current_tank_id()");
    expect(rlsSql).toContain("CREATE OR REPLACE FUNCTION rls_current_user_id()");
  });

  it("enforces both ENABLE and FORCE ROW LEVEL SECURITY on all critical tables", () => {
    const requiredTables = [
      "projects",
      "bulk_tanks",
      "users",
      "assets",
      "asset_assignments",
      "vehicle_allocations",
      "fuel_prices",
      "fuel_requests",
      "fuel_issues",
      "fuel_issue_corrections",
      "tank_dips",
      "bulk_requests",
      "daily_conditions",
      "meter_readings",
      "meter_outages",
      "rental_rates",
      "bills",
      "bill_revisions",
      "bill_line_items",
      "payments",
      "budgets",
      "credit_notes",
      "billing_site_overrides",
      "service_records",
      "service_intervals",
      "service_items",
      "service_attachments",
      "api_keys",
      "audit_logs",
      "outbox_messages",
    ];

    for (const table of requiredTables) {
      expect(
        rlsSql,
        `Table '${table}' is missing ENABLE ROW LEVEL SECURITY`
      ).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);

      expect(
        rlsSql,
        `Table '${table}' is missing FORCE ROW LEVEL SECURITY`
      ).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it("implements fuel issue isolation policies", () => {
    expect(rlsSql).toContain("CREATE POLICY fuel_issues_select_policy ON fuel_issues");
    expect(rlsSql).toContain("CREATE POLICY fuel_issues_insert_policy ON fuel_issues");
    expect(rlsSql).toContain("CREATE POLICY fuel_issues_update_policy ON fuel_issues");
    expect(rlsSql).toContain("CREATE POLICY fuel_issues_delete_policy ON fuel_issues");

    // Deletion is restricted to admin only (immutability rule)
    expect(rlsSql).toContain("USING (rls_is_admin()); -- Fuel issues must never be hard-deleted");
  });

  it("enforces financial barrier for WORKSHOP and SITE_PUMP roles (SEC-02 parity)", () => {
    expect(rlsSql).toContain("CREATE POLICY bills_select_policy ON bills");
    expect(rlsSql).toContain("CREATE POLICY bills_write_policy ON bills");
    expect(rlsSql).toContain("CREATE POLICY credit_notes_policy ON credit_notes");

    // Bills are readable only by ADMIN or USER belonging to the project
    expect(rlsSql).toContain(
      "OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())"
    );
  });

  it("enforces append-only immutability for audit_logs (AUD-01 parity)", () => {
    // Inserts allowed
    expect(rlsSql).toContain("CREATE POLICY audit_logs_insert_policy ON audit_logs");
    expect(rlsSql).toContain("WITH CHECK (true); -- Any authenticated session can append audit records");

    // Updates unconditionally rejected
    expect(rlsSql).toContain("CREATE POLICY audit_logs_update_policy ON audit_logs");
    expect(rlsSql).toContain("USING (false)");

    // Deletes unconditionally rejected
    expect(rlsSql).toContain("CREATE POLICY audit_logs_delete_policy ON audit_logs");
    expect(rlsSql).toContain("USING (false); -- STRICTLY DENIED: Audit logs must never be deleted");
  });
});

describe("RLS-01: Connection Pool Hygiene & Context Helpers", () => {
  it("builds SQL SET LOCAL statements with proper parameter escaping", () => {
    const ctx: TenantSessionContext = {
      tenantId: "tenant-100",
      userId: "user-200",
      userRole: "SITE_PUMP",
      projectId: "proj-300",
      bulkTankId: "tank-400",
      bypassRls: false,
    };

    const sqls = buildSetLocalSql(ctx);
    expect(sqls.length).toBe(6);
    expect(sqls[0]).toBe("SET LOCAL app.current_tenant_id = 'tenant-100';");
    expect(sqls[1]).toBe("SET LOCAL app.current_user_id = 'user-200';");
    expect(sqls[2]).toBe("SET LOCAL app.current_user_role = 'SITE_PUMP';");
    expect(sqls[3]).toBe("SET LOCAL app.current_project_id = 'proj-300';");
    expect(sqls[4]).toBe("SET LOCAL app.current_tank_id = 'tank-400';");
    expect(sqls[5]).toBe("SET LOCAL app.bypass_rls = 'false';");
  });

  it("escapes single quotes to prevent SQL injection in session context", () => {
    const ctx: TenantSessionContext = {
      userRole: "USER'; DROP TABLE users; --",
      projectId: "site'1",
    };

    const sqls = buildSetLocalSql(ctx);
    expect(sqls[2]).toBe("SET LOCAL app.current_user_role = 'USER''; DROP TABLE users; --';");
    expect(sqls[3]).toBe("SET LOCAL app.current_project_id = 'site''1';");
  });

  it("generates session reset statements for pool sanitization", () => {
    const resets = buildResetSessionSql();
    expect(resets).toContain("RESET app.current_tenant_id;");
    expect(resets).toContain("RESET app.current_user_id;");
    expect(resets).toContain("RESET app.current_user_role;");
    expect(resets).toContain("RESET app.current_project_id;");
    expect(resets).toContain("RESET app.current_tank_id;");
    expect(resets).toContain("RESET app.bypass_rls;");
  });

  it("executes work within transaction and automatically commits", async () => {
    const executedQueries: string[] = [];
    const mockExecutor: PgQueryExecutor = {
      async query(sql: string) {
        executedQueries.push(sql);
        return { rows: [] };
      },
    };

    const ctx: TenantSessionContext = {
      userRole: "ADMIN",
      projectId: "proj-1",
    };

    let workExecuted = false;
    const result = await withTenantContext(mockExecutor, ctx, async () => {
      workExecuted = true;
      return "SUCCESS_VAL";
    });

    expect(workExecuted).toBe(true);
    expect(result).toBe("SUCCESS_VAL");

    // Verified query sequence
    expect(executedQueries[0]).toBe("BEGIN;");
    expect(executedQueries).toContain("SET LOCAL app.current_user_role = 'ADMIN';");
    expect(executedQueries).toContain("SET LOCAL app.current_project_id = 'proj-1';");
    expect(executedQueries[executedQueries.length - 1]).toBe("COMMIT;");
  });

  it("rolls back transaction on error without leaking context", async () => {
    const executedQueries: string[] = [];
    const mockExecutor: PgQueryExecutor = {
      async query(sql: string) {
        executedQueries.push(sql);
        return { rows: [] };
      },
    };

    const ctx: TenantSessionContext = {
      userRole: "SITE_PUMP",
    };

    await expect(
      withTenantContext(mockExecutor, ctx, async () => {
        throw new Error("PUMP_READING_DISCREPANCY");
      })
    ).rejects.toThrow("PUMP_READING_DISCREPANCY");

    expect(executedQueries[0]).toBe("BEGIN;");
    expect(executedQueries[executedQueries.length - 1]).toBe("ROLLBACK;");
  });
});
