// ============================================================================
// Phase 4/5: PostgreSQL Connection Pooling, Composite Indexes & EXPLAIN ANALYZE Test Suite
// Reference: Fuel-System-V3 Plan Sections 9, 10 (Steps 07, 08, 09, 10)
//
// Verifies:
// 1. Connection URL parsing with pool limits and timeout parameters.
// 2. ManagedPgPool connection lifecycle: acquisition, release, queueing, drain.
// 3. PoolStats metrics and healthCheck latency recording.
// 4. SQL index migration script (004_performance_indexes.sql) structural coverage.
// 5. Automated EXPLAIN ANALYZE evaluation (Index Scan vs Seq Scan detection).
// ============================================================================

import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parsePostgresUrl,
  ManagedPgPool,
} from "../src/lib/db/pg-pool";
import {
  evaluatePlanNode,
  generateExplainAnalyzeReport,
} from "../scripts/perf/explain_analyze";
import {
  clearRouteLatencyMetrics,
  getRouteLatencyMetrics,
} from "../src/lib/observability/timing";

describe("Phase 4/5: PostgreSQL Connection Pooling & Performance Indexing", () => {
  beforeEach(() => {
    clearRouteLatencyMetrics();
  });

  // --------------------------------------------------------------------------
  // 1. Connection URL Parsing Tests (Step 07 & 10)
  // --------------------------------------------------------------------------
  describe("PostgreSQL Connection URL Parsing", () => {
    it("parses connection string parameters including connection_limit and pool_timeout", () => {
      const url =
        "postgresql://erp_app:SecretPass123@db.prod.internal:5432/fuelsystem_erp?sslmode=require&connection_limit=25&pool_timeout=15";
      const parsed = parsePostgresUrl(url);

      expect(parsed.user).toBe("erp_app");
      expect(parsed.password).toBe("SecretPass123");
      expect(parsed.host).toBe("db.prod.internal");
      expect(parsed.port).toBe(5432);
      expect(parsed.database).toBe("fuelsystem_erp");
      expect(parsed.sslMode).toBe("require");
      expect(parsed.connectionLimit).toBe(25);
      expect(parsed.poolTimeoutSeconds).toBe(15);
    });

    it("falls back safely on missing or invalid URLs", () => {
      const parsed = parsePostgresUrl("invalid-uri");
      expect(parsed.user).toBe("postgres");
      expect(parsed.host).toBe("localhost");
      expect(parsed.port).toBe(5432);
      expect(parsed.database).toBe("fuelsystem_erp");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Connection Pool Lifecycle & Concurrency (Step 10)
  // --------------------------------------------------------------------------
  describe("Managed Connection Pool Lifecycle", () => {
    it("acquires, re-uses, and releases pooled connections correctly", async () => {
      const pool = new ManagedPgPool({
        maxConnections: 5,
        minConnections: 1,
        connectionTimeoutMs: 1000,
      });

      const client1 = await pool.acquire();
      expect(client1.id).toBeDefined();

      let stats = pool.getStats();
      expect(stats.activeConnections).toBe(1);
      expect(stats.idleConnections).toBe(0);

      pool.release(client1);

      stats = pool.getStats();
      expect(stats.activeConnections).toBe(0);
      expect(stats.idleConnections).toBe(1);

      // Re-acquires the same client from idle pool
      const client2 = await pool.acquire();
      expect(client2.id).toBe(client1.id);

      pool.release(client2);
      await pool.drain();
    });

    it("executes withClient wrapper safely releasing connection on completion", async () => {
      const pool = new ManagedPgPool({ maxConnections: 3 });

      const result = await pool.withClient(async (client) => {
        expect(client.id).toBeDefined();
        return "query_done";
      });

      expect(result).toBe("query_done");
      expect(pool.getStats().activeConnections).toBe(0);
      expect(pool.getStats().idleConnections).toBe(1);

      await pool.drain();
    });

    it("enforces maxConnections limit and queues waiting callers", async () => {
      const pool = new ManagedPgPool({
        maxConnections: 2,
        connectionTimeoutMs: 500,
      });

      const c1 = await pool.acquire();
      const c2 = await pool.acquire();

      let stats = pool.getStats();
      expect(stats.activeConnections).toBe(2);

      // 3rd caller must wait
      let acquiredThird = false;
      const promise3 = pool.acquire().then((c3) => {
        acquiredThird = true;
        pool.release(c3);
      });

      expect(acquiredThird).toBe(false);
      expect(pool.getStats().waitingRequests).toBe(1);

      // Releasing c1 unblocks the waiting caller
      pool.release(c1);
      await promise3;
      expect(acquiredThird).toBe(true);

      pool.release(c2);
      await pool.drain();
    });

    it("times out waiting requests when pool remains saturated", async () => {
      const pool = new ManagedPgPool({
        maxConnections: 1,
        connectionTimeoutMs: 50,
      });

      const c1 = await pool.acquire();

      await expect(pool.acquire()).rejects.toThrow(/Connection pool timeout/);

      pool.release(c1);
      await pool.drain();
    });

    it("performs health check and records pg_pool_health_check latency metric", async () => {
      const pool = new ManagedPgPool();
      const check = await pool.healthCheck();

      expect(check.ok).toBe(true);
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);

      const metrics = getRouteLatencyMetrics("pg_pool_health_check");
      expect(metrics).toHaveLength(1);
      expect(metrics[0].count).toBe(1);

      await pool.drain();
    });
  });

  // --------------------------------------------------------------------------
  // 3. PostgreSQL Composite Index Migration Script Verification (Step 08)
  // --------------------------------------------------------------------------
  describe("PostgreSQL Performance Indexes (004_performance_indexes.sql)", () => {
    const migrationPath = path.resolve(
      __dirname,
      "..",
      "scripts",
      "migrations",
      "pg",
      "004_performance_indexes.sql"
    );

    it("verifies index migration file exists and contains all required composite indexes", () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, "utf-8");

      // Fuel issues indexes
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_fuel_issues_asset_date_desc");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_fuel_issues_tank_date_desc");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_fuel_issues_active_date_desc");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_fuel_issues_month_agg");

      // Asset indexes
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_assets_status_project_code");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_assets_reg_no_lookup");

      // Billing indexes
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_bills_period_status_proj");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_bills_grand_total_desc");

      // Meter & Operational indexes
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_meter_readings_asset_date_desc");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_fuel_requests_pending_date");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_daily_conditions_asset_date_desc");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Automated EXPLAIN ANALYZE Evaluation (Step 09)
  // --------------------------------------------------------------------------
  describe("EXPLAIN ANALYZE Query Plan Analyzer", () => {
    it("flags sequential scans (Seq Scan) as suboptimal", () => {
      const badNode = {
        nodeType: "Seq Scan" as const,
        relationName: "fuel_issues",
        startupCost: 0,
        totalCost: 1540.2,
        planRows: 10000,
      };

      const result = evaluatePlanNode(badNode, "idx_fuel_issues_active_date_desc");
      expect(result.isOptimized).toBe(false);
      expect(result.verdict).toContain("Suboptimal: Seq Scan detected");
    });

    it("approves index scans using expected composite indexes", () => {
      const goodNode = {
        nodeType: "Index Scan" as const,
        relationName: "fuel_issues",
        indexName: "idx_fuel_issues_active_date_desc",
        startupCost: 0.28,
        totalCost: 12.45,
        planRows: 25,
      };

      const result = evaluatePlanNode(goodNode, "idx_fuel_issues_active_date_desc");
      expect(result.isOptimized).toBe(true);
      expect(result.verdict).toContain("Optimal: Utilizing Index Scan");
    });

    it("generates a full markdown report confirming 100% index coverage", () => {
      const { results, markdown } = generateExplainAnalyzeReport();

      expect(results.length).toBeGreaterThanOrEqual(4);
      expect(results.every((r) => r.isOptimized)).toBe(true);
      expect(markdown).toContain("PERF-02");
      expect(markdown).toContain("100% Index Scan Coverage");
    });
  });
});
