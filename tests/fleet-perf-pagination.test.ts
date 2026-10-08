// ============================================================================
// Phase 1/2: Fleet Assets Pagination & Virtualization Test Suite
// Reference: Fuel-System-V3 Plan Sections 6, 7, 8
//
// Verifies:
// 1. Pagination parameter normalization and clamping (25, 50, 100).
// 2. Parallel count and narrow projection findMany execution.
// 3. Search and category filter clause generation.
// 4. Role-based site scoping (isSiteUser isolation).
// 5. Route latency metric recording.
// ============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn((promises) => Promise.all(promises)),
  };
  return { mockPrisma };
});

vi.mock("../src/lib/db", () => ({
  prisma: mockPrisma,
}));

import { getFleetAssetsPaginated } from "../src/lib/fleet/query-assets";
import {
  clearRouteLatencyMetrics,
  getRouteLatencyMetrics,
} from "../src/lib/observability/timing";

describe("Phase 1/2: Fleet Assets Pagination & Query Optimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRouteLatencyMetrics();
  });

  describe("Pagination & Boundary Enforcement", () => {
    it("applies default page=1 and limit=25 when not specified", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(60);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      const result = await getFleetAssetsPaginated({});

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 25,
        })
      );
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(25);
      expect(result.pagination.totalCount).toBe(60);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it("clamps limit greater than MAX_PAGE_SIZE (100) down to 100", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(500);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      const result = await getFleetAssetsPaginated({ limit: 500, page: 2 });

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 100,
          take: 100,
        })
      );
      expect(result.pagination.limit).toBe(100);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.totalPages).toBe(5);
    });

    it("handles page out of bounds gracefully", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(10);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      const result = await getFleetAssetsPaginated({ page: -5 });

      expect(result.pagination.page).toBe(1);
      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        })
      );
    });
  });

  describe("Query Filters & Search", () => {
    it("builds multi-field OR query for text search", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(1);
      mockPrisma.asset.findMany.mockResolvedValueOnce([
        {
          id: "asset-1",
          code: "HEX-01",
          regNo: "WP-CAB-1234",
          brand: "CAT",
          model: "320D",
          site: "Colombo Port",
          meterType: "HOURS",
          status: "ACTIVE",
          category: { id: "cat-1", code: "HEX", name: "Heavy Excavator" },
        },
      ]);

      const result = await getFleetAssetsPaginated({ q: "CAT" });

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { code: { contains: "CAT" } },
              { brand: { contains: "CAT" } },
              { model: { contains: "CAT" } },
              { regNo: { contains: "CAT" } },
              { site: { contains: "CAT" } },
            ],
          }),
        })
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe("HEX-01");
    });

    it("filters by category code when specified", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(5);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      await getFleetAssetsPaginated({ categoryCode: "TRUCK" });

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { code: "TRUCK" },
          }),
        })
      );
    });
  });

  describe("Role-Based Site Scoping & Narrow Projections", () => {
    it("enforces projectId scoping for site users", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(3);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      await getFleetAssetsPaginated({
        role: "USER",
        projectId: "proj-kotugoda",
      });

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "proj-kotugoda",
            status: { in: ["ACTIVE", "INACTIVE"] },
          }),
        })
      );
    });

    it("does not restrict projectId for ADMIN users", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(100);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      await getFleetAssetsPaginated({
        role: "ADMIN",
        projectId: "proj-kotugoda",
      });

      const callArgs = mockPrisma.asset.findMany.mock.calls[0][0];
      expect(callArgs.where.projectId).toBeUndefined();
    });

    it("verifies narrow select projection to avoid heavy fields", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(1);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      await getFleetAssetsPaginated({});

      const callArgs = mockPrisma.asset.findMany.mock.calls[0][0];
      expect(callArgs.select).toBeDefined();
      expect(callArgs.select.id).toBe(true);
      expect(callArgs.select.code).toBe(true);
      expect(callArgs.select.category).toEqual({
        select: { id: true, code: true, name: true },
      });
      // Ensure heavy relation tables are NOT included
      expect(callArgs.include).toBeUndefined();
    });
  });

  describe("Latency Observability", () => {
    it("records fleet_assets_paginated latency metrics", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(20);
      mockPrisma.asset.findMany.mockResolvedValueOnce([]);

      await getFleetAssetsPaginated({});

      const metricsList = getRouteLatencyMetrics("fleet_assets_paginated");
      expect(metricsList).toHaveLength(1);
      expect(metricsList[0].count).toBe(1);
      expect(metricsList[0].p50Ms).toBeGreaterThanOrEqual(0);
    });
  });
});
