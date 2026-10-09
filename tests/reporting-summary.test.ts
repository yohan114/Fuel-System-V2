// ============================================================================
// Phase 17 — Reporting & Summary Aggregates Test Suite
// Reference: Fuel-System-V3 Plan Section 22 (Phase 17 — Reporting and Analytics)
//
// Tests:
// 1. Monthly fuel summary push-down grouping & Redis caching
// 2. Daily time-series rollups for trends
// 3. Asset utilization summary calculations
// 4. Billing period rollups & status breakdown
// 5. Optimized fuel aggregation engine with narrow projections
// 6. Background summary worker refresh & cache warming
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    fuelIssue: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
    },
    bill: {
      groupBy: vi.fn(),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
  return { mockPrisma };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import {
  getMonthlyFuelSummary,
  getDailyFuelSummary,
  getAssetUtilizationSummary,
  getBillingSummary,
  invalidateSummaryCache,
} from "@/lib/reporting/summary-service";
import { aggregateFuelDataOptimized } from "@/lib/reporting/optimized-aggregate";
import { processSummaryRefreshJob, type SummaryRefreshJobData } from "@/lib/workers/summary-worker";
import { setRedisClient, InMemoryCacheClient, closeRedisClient } from "@/lib/cache/redis";
import type { JobContext } from "@/lib/queue/queue-manager";

describe("Phase 17: Reporting & Summary Aggregates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRedisClient(new InMemoryCacheClient());
    mockPrisma.fuelIssue.groupBy.mockResolvedValue([]);
    mockPrisma.fuelIssue.findMany.mockResolvedValue([]);
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.bill.groupBy.mockResolvedValue([]);
  });

  afterEach(async () => {
    await closeRedisClient();
  });

  // --------------------------------------------------------------------------
  // 1. Monthly Fuel Summary Grouping & Caching
  // --------------------------------------------------------------------------
  describe("1. Monthly Fuel Summary Aggregations", () => {
    it("computes monthly fuel rollups via push-down groupBy and caches in Redis", async () => {
      const mockGroupByData = [
        {
          fuelKind: "AUTO_DIESEL",
          _sum: { litres: 12500.5, totalCost: 4500000 },
          _count: { id: 180 },
        },
        {
          fuelKind: "SUPER_DIESEL",
          _sum: { litres: 3200.0, totalCost: 1280000 },
          _count: { id: 45 },
        },
      ];

      const mockPrisma = {
        fuelIssue: {
          groupBy: vi.fn().mockResolvedValue(mockGroupByData),
        },
      } as any;

      // 1. First call: executes groupBy against database
      const summary1 = await getMonthlyFuelSummary("2026-08", { prismaClient: mockPrisma });
      expect(summary1.fromCache).toBe(false);
      expect(summary1.totalLitres).toBe(15700.5);
      expect(summary1.totalCostCents).toBe(5780000);
      expect(summary1.issueCount).toBe(225);
      expect(summary1.byFuelKind["AUTO_DIESEL"].litres).toBe(12500.5);
      expect(summary1.byFuelKind["SUPER_DIESEL"].litres).toBe(3200.0);
      expect(mockPrisma.fuelIssue.groupBy).toHaveBeenCalledTimes(1);

      // 2. Second call: served from Redis cache without hitting DB
      const summary2 = await getMonthlyFuelSummary("2026-08", { prismaClient: mockPrisma });
      expect(summary2.fromCache).toBe(true);
      expect(summary2.totalLitres).toBe(15700.5);
      expect(mockPrisma.fuelIssue.groupBy).toHaveBeenCalledTimes(1);

      // 3. Invalidate and re-query
      await invalidateSummaryCache("2026-08");
      const summary3 = await getMonthlyFuelSummary("2026-08", { prismaClient: mockPrisma });
      expect(summary3.fromCache).toBe(false);
      expect(mockPrisma.fuelIssue.groupBy).toHaveBeenCalledTimes(2);
    });

    it("scopes groupBy query by project site when projectId is supplied", async () => {
      const mockPrisma = {
        fuelIssue: {
          groupBy: vi.fn().mockResolvedValue([]),
        },
      } as any;

      await getMonthlyFuelSummary("2026-08", { projectId: "site-colombo", prismaClient: mockPrisma });

      expect(mockPrisma.fuelIssue.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { bulkTank: { projectId: "site-colombo" } },
              { asset: { projectId: "site-colombo" } },
            ],
          }),
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Daily Time-Series Rollup
  // --------------------------------------------------------------------------
  describe("2. Daily Time-Series Rollups", () => {
    it("aggregates daily fuel issues into time-series chart data", async () => {
      const mockIssues = [
        { issueDate: new Date("2026-08-01T04:00:00Z"), litres: 50.0, totalCost: 18000 },
        { issueDate: new Date("2026-08-01T08:00:00Z"), litres: 75.0, totalCost: 27000 },
        { issueDate: new Date("2026-08-02T05:00:00Z"), litres: 100.0, totalCost: 36000 },
      ];

      const mockPrisma = {
        fuelIssue: {
          findMany: vi.fn().mockResolvedValue(mockIssues),
        },
      } as any;

      const daily = await getDailyFuelSummary(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-02T23:59:59Z"),
        { prismaClient: mockPrisma }
      );

      expect(daily).toHaveLength(2);
      expect(daily[0].date).toBe("2026-08-01");
      expect(daily[0].totalLitres).toBe(125.0);
      expect(daily[0].issueCount).toBe(2);

      expect(daily[1].date).toBe("2026-08-02");
      expect(daily[1].totalLitres).toBe(100.0);
      expect(daily[1].issueCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Asset Utilization Summary
  // --------------------------------------------------------------------------
  describe("3. Asset Utilization Rollups", () => {
    it("aggregates per-asset monthly consumption and links category details", async () => {
      const mockGroupedAssets = [
        { assetId: "a-1", _sum: { litres: 500.0, totalCost: 180000 }, _count: { id: 12 } },
        { assetId: "a-2", _sum: { litres: 350.0, totalCost: 126000 }, _count: { id: 8 } },
      ];

      const mockAssets = [
        { id: "a-1", code: "CAB-101", category: { name: "Crew Cab" } },
        { id: "a-2", code: "EXC-201", category: { name: "Excavator" } },
      ];

      const mockPrisma = {
        fuelIssue: { groupBy: vi.fn().mockResolvedValue(mockGroupedAssets) },
        asset: { findMany: vi.fn().mockResolvedValue(mockAssets) },
      } as any;

      const utilization = await getAssetUtilizationSummary("2026-08", { prismaClient: mockPrisma });

      expect(utilization).toHaveLength(2);
      expect(utilization[0].code).toBe("CAB-101");
      expect(utilization[0].totalLitres).toBe(500.0);
      expect(utilization[0].categoryName).toBe("Crew Cab");

      expect(utilization[1].code).toBe("EXC-201");
      expect(utilization[1].totalLitres).toBe(350.0);
      expect(utilization[1].categoryName).toBe("Excavator");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Billing Period Rollups
  // --------------------------------------------------------------------------
  describe("4. Billing Period Rollups", () => {
    it("aggregates invoice totals by status for a billing month", async () => {
      const mockGroupedBills = [
        {
          status: "ISSUED",
          _sum: { grandTotalCents: 1500000, paidAmountCents: 500000 },
          _count: { _all: 10 },
        },
        {
          status: "PAID",
          _sum: { grandTotalCents: 800000, paidAmountCents: 800000 },
          _count: { _all: 5 },
        },
      ];

      const mockPrisma = {
        bill: { groupBy: vi.fn().mockResolvedValue(mockGroupedBills) },
      } as any;

      const billingSummary = await getBillingSummary("2026-08", { prismaClient: mockPrisma });

      expect(billingSummary.periodKey).toBe("2026-08");
      expect(billingSummary.totalInvoices).toBe(15);
      expect(billingSummary.totalGrandCents).toBe(2300000);
      expect(billingSummary.totalPaidCents).toBe(1300000);
      expect(billingSummary.totalBalanceDueCents).toBe(1000000);
      expect(billingSummary.byStatus["ISSUED"].count).toBe(10);
      expect(billingSummary.byStatus["PAID"].count).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Optimized Aggregate Engine
  // --------------------------------------------------------------------------
  describe("5. Optimized Fuel Report Engine", () => {
    it("aggregates fuel report data with narrow projections and compact memory structures", async () => {
      mockPrisma.fuelIssue.findMany.mockResolvedValueOnce([
        {
          id: "issue-1",
          litres: 120.5,
          totalCost: 45000,
          fuelKind: "AUTO_DIESEL",
          issueDate: new Date("2026-08-05T08:00:00Z"),
          assetId: "a-1",
          asset: {
            id: "a-1",
            code: "CAB-101",
            brand: "Toyota",
            typeLabel: "Double Cab",
            meterType: "KM",
            category: { id: "cat-1", name: "Cab", code: "CAB" },
            project: { id: "p-1", name: "Colombo Site", code: "COL" },
          },
          bulkTank: null,
        },
      ]);

      const report = await aggregateFuelDataOptimized({
        from: new Date("2026-08-01T00:00:00Z"),
        to: new Date("2026-08-31T23:59:59Z"),
      });

      expect(report).toBeDefined();
      expect(report.totalLitres).toBe(120.5);
      expect(report.totalCostCents).toBe(45000);
      expect(report.issueCount).toBe(1);
      expect(report.fuelKindTotals["AUTO_DIESEL"].litres).toBe(120.5);
      expect(report.categoryTotals["cat-1"].name).toBe("Cab");
      expect(report.assetTotals["a-1"].code).toBe("CAB-101");
      expect(report.siteBreakdown).toHaveLength(1);
      expect(report.siteBreakdown[0].name).toBe("Colombo Site");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Summary Refresh Worker
  // --------------------------------------------------------------------------
  describe("6. Summary Refresh Worker", () => {
    it("refreshes materialized summaries and warms the Redis cache", async () => {
      const progressList: number[] = [];
      const dummyJobCtx: JobContext<SummaryRefreshJobData> = {
        id: "summary-job-1",
        name: "refresh-materialized-summaries",
        data: {
          periodKey: "2026-08",
          refreshMaterializedViews: false,
        },
        attemptsMade: 1,
        updateProgress: async (p: any) => {
          progressList.push(Number(p));
        },
      };

      const result = await processSummaryRefreshJob(dummyJobCtx);

      expect(result.periodKey).toBe("2026-08");
      expect(result.cacheWarmed).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(progressList).toContain(10);
      expect(progressList).toContain(50);
      expect(progressList).toContain(100);
    });
  });
});
