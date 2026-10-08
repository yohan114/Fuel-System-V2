// ============================================================================
// Phase 0–3: Performance Baseline, Query Optimization & Pagination Test Suite
// Reference: Fuel-System-V3 Plan Sections 5, 6, 7, and 8
//
// Verifies:
// 1. Pagination parameter normalization & boundary clamping (max limit: 100).
// 2. Pagination metadata calculation (totalPages, hasNextPage, hasPrevPage).
// 3. Request timing & percentile calculation (p50, p95, p99, Server-Timing).
// 4. Narrow projection and page-scoped fuel issues query execution.
// ============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    fuelIssue: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    assetAssignment: {
      findMany: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("../src/lib/db", () => ({
  prisma: mockPrisma,
}));
import {
  normalizePaginationParams,
  buildPaginationMeta,
} from "../src/lib/pagination/paginate";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../src/lib/pagination/types";
import {
  recordRouteLatency,
  getRouteLatencyMetrics,
  clearRouteLatencyMetrics,
  formatServerTiming,
} from "../src/lib/observability/timing";
import { getFuelIssuesPaginated } from "../src/lib/fuel/query-issues";

describe("Phase 0–3: Performance, Pagination & Optimization Engine", () => {
  beforeEach(() => {
    clearRouteLatencyMetrics();
  });

  // --------------------------------------------------------------------------
  // 1. Pagination Normalization Tests (Phase 2)
  // --------------------------------------------------------------------------
  describe("Pagination Normalization (Phase 2)", () => {
    it("should apply default page=1 and limit=25 when undefined", () => {
      const result = normalizePaginationParams();
      expect(result.page).toBe(1);
      expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(result.skip).toBe(0);
    });

    it("should parse string query parameters cleanly", () => {
      const result = normalizePaginationParams({ page: "3", limit: "50" });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
      expect(result.skip).toBe(100); // (3 - 1) * 50
    });

    it("should clamp page numbers less than 1 to 1", () => {
      const result = normalizePaginationParams({ page: "-5", limit: "25" });
      expect(result.page).toBe(1);
      expect(result.skip).toBe(0);
    });

    it("should clamp limit to MAX_PAGE_SIZE (100) to prevent memory attacks", () => {
      const result = normalizePaginationParams({ page: "1", limit: "5000" });
      expect(result.limit).toBe(MAX_PAGE_SIZE);
    });

    it("should fallback to DEFAULT_PAGE_SIZE on NaN inputs", () => {
      const result = normalizePaginationParams({ page: "invalid", limit: "bad" });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(result.skip).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Pagination Metadata Tests (Phase 2)
  // --------------------------------------------------------------------------
  describe("Pagination Metadata Calculation (Phase 2)", () => {
    it("should correctly compute totalPages and navigation flags", () => {
      // 120 items at limit 25 -> 5 pages
      const meta = buildPaginationMeta(120, 2, 25);
      expect(meta.page).toBe(2);
      expect(meta.limit).toBe(25);
      expect(meta.totalCount).toBe(120);
      expect(meta.totalPages).toBe(5);
      expect(meta.hasPrevPage).toBe(true);
      expect(meta.hasNextPage).toBe(true);
    });

    it("should set hasNextPage=false on the final page", () => {
      const meta = buildPaginationMeta(120, 5, 25);
      expect(meta.page).toBe(5);
      expect(meta.totalPages).toBe(5);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPrevPage).toBe(true);
    });

    it("should handle totalCount=0 gracefully", () => {
      const meta = buildPaginationMeta(0, 1, 25);
      expect(meta.totalCount).toBe(0);
      expect(meta.totalPages).toBe(1);
      expect(meta.page).toBe(1);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPrevPage).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Observability & Timing Metrics (Phase 0)
  // --------------------------------------------------------------------------
  describe("Performance Observability & Percentiles (Phase 0)", () => {
    it("should record latency samples and accurately compute percentiles", () => {
      const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const s of samples) {
        recordRouteLatency("test_route", s);
      }

      const metrics = getRouteLatencyMetrics("test_route");
      expect(metrics).toHaveLength(1);
      const m = metrics[0];
      expect(m.count).toBe(10);
      expect(m.minMs).toBe(10);
      expect(m.maxMs).toBe(100);
      expect(m.avgMs).toBe(55);
      expect(m.p50Ms).toBe(50);
      expect(m.p95Ms).toBe(100);
    });

    it("should format standard W3C Server-Timing headers", () => {
      const header = formatServerTiming({
        app: 24.53,
        db: 12.18,
      });
      expect(header).toBe("app;dur=24.5, db;dur=12.2");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Optimized Query Engine (Phase 1 & 2)
  // --------------------------------------------------------------------------
  describe("Optimized Query Execution (Phase 1 & 2)", () => {
    it("should execute getFuelIssuesPaginated and return compliant paginated results", async () => {
      mockPrisma.fuelIssue.findMany.mockResolvedValueOnce([
        {
          id: "issue-1",
          issueDate: new Date("2026-10-01T10:00:00Z"),
          litres: 45.0,
          fuelKind: "AUTO_DIESEL",
          source: "STATION",
          voided: false,
          meterReading: 12050,
          readingType: "KM",
          corrections: [],
          bulkTankId: "tank-1",
          assetId: "asset-1",
          asset: {
            id: "asset-1",
            code: "CAB-101",
            regNo: "WP-CAB-101",
            category: { name: "Cab", code: "CAB" },
            projectId: "proj-1",
            project: { id: "proj-1", name: "Colombo Site", code: "COL" },
          },
          bulkTank: {
            id: "tank-1",
            name: "Main Diesel Tank",
            projectId: "proj-1",
            project: { id: "proj-1", name: "Colombo Site", code: "COL" },
          },
          issuedBy: {
            id: "user-1",
            name: "Sunil Silva",
            username: "sunil",
          },
        },
      ]);
      mockPrisma.fuelIssue.count.mockResolvedValueOnce(150);
      mockPrisma.assetAssignment.findMany.mockResolvedValueOnce([]);

      const result = await getFuelIssuesPaginated({ page: 1, limit: 10 });

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("pagination");
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalCount).toBe(150);
      expect(result.pagination.totalPages).toBe(15);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPrevPage).toBe(false);

      const item = result.data[0];
      expect(item.id).toBe("issue-1");
      expect(item.litres).toBe(45.0);
      expect(item.fuelKind).toBe("AUTO_DIESEL");
      expect(item.asset.code).toBe("CAB-101");
      expect(item.asset.regNo).toBe("WP-CAB-101");
      expect(item.asset.category).toBe("Cab");
      expect(item.bulkTank?.name).toBe("Main Diesel Tank");
    });
  });
});
