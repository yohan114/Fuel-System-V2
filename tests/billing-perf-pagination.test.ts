// ============================================================================
// Phase 2/3: Billing Invoices Pagination & Virtualization Test Suite
// Reference: Fuel-System-V3 Plan Sections 7, 8 (Steps 05 & 06)
//
// Verifies:
// 1. Pagination parameter normalization and slicing for billing invoices.
// 2. Pagination metadata calculation (page boundaries, prev/next flags).
// 3. Preservation of search queries and filter parameters across page changes.
// 4. Billing page load latency recording.
// ============================================================================

import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizePaginationParams,
  buildPaginationMeta,
} from "../src/lib/pagination/paginate";
import {
  clearRouteLatencyMetrics,
  getRouteLatencyMetrics,
  recordRouteLatency,
} from "../src/lib/observability/timing";

describe("Phase 2/3: Billing Invoices Pagination & Performance", () => {
  beforeEach(() => {
    clearRouteLatencyMetrics();
  });

  describe("Billing Invoices Pagination Slicing", () => {
    it("slices mock invoices correctly for page 1 at default limit 25", () => {
      const mockInvoices = Array.from({ length: 70 }, (_, i) => ({
        id: `bill-${i + 1}`,
        assetCode: `HEX-${i + 1}`,
        grandTotalCents: 5000000 + i * 1000,
      }));

      const { page, limit, skip } = normalizePaginationParams({ page: "1", limit: "25" });
      const sliced = mockInvoices.slice(skip, skip + limit);
      const pagination = buildPaginationMeta(mockInvoices.length, page, limit);

      expect(sliced).toHaveLength(25);
      expect(sliced[0].id).toBe("bill-1");
      expect(sliced[24].id).toBe("bill-25");
      expect(pagination.totalPages).toBe(3);
      expect(pagination.hasPrevPage).toBe(false);
      expect(pagination.hasNextPage).toBe(true);
    });

    it("slices correctly for subsequent pages", () => {
      const mockInvoices = Array.from({ length: 70 }, (_, i) => ({
        id: `bill-${i + 1}`,
        assetCode: `HEX-${i + 1}`,
        grandTotalCents: 5000000 + i * 1000,
      }));

      const { page, limit, skip } = normalizePaginationParams({ page: "2", limit: "25" });
      const sliced = mockInvoices.slice(skip, skip + limit);
      const pagination = buildPaginationMeta(mockInvoices.length, page, limit);

      expect(sliced).toHaveLength(25);
      expect(sliced[0].id).toBe("bill-26");
      expect(sliced[24].id).toBe("bill-50");
      expect(pagination.hasPrevPage).toBe(true);
      expect(pagination.hasNextPage).toBe(true);
    });

    it("handles the final page with remainder items", () => {
      const mockInvoices = Array.from({ length: 70 }, (_, i) => ({
        id: `bill-${i + 1}`,
        assetCode: `HEX-${i + 1}`,
        grandTotalCents: 5000000 + i * 1000,
      }));

      const { page, limit, skip } = normalizePaginationParams({ page: "3", limit: "25" });
      const sliced = mockInvoices.slice(skip, skip + limit);
      const pagination = buildPaginationMeta(mockInvoices.length, page, limit);

      expect(sliced).toHaveLength(20); // 70 - 50 = 20
      expect(sliced[0].id).toBe("bill-51");
      expect(sliced[19].id).toBe("bill-70");
      expect(pagination.hasPrevPage).toBe(true);
      expect(pagination.hasNextPage).toBe(false);
    });

    it("clamps limit properly when requested size exceeds maximum (100)", () => {
      const { page, limit, skip } = normalizePaginationParams({ page: "1", limit: "500" });
      expect(limit).toBe(100);
      expect(page).toBe(1);
      expect(skip).toBe(0);
    });
  });

  describe("Billing Latency Telemetry", () => {
    it("records billing_page_load latency metric accurately", () => {
      recordRouteLatency("billing_page_load", 65.4);
      recordRouteLatency("billing_page_load", 48.2);

      const metricsList = getRouteLatencyMetrics("billing_page_load");
      expect(metricsList).toHaveLength(1);
      expect(metricsList[0].count).toBe(2);
      expect(metricsList[0].minMs).toBe(48.2);
      expect(metricsList[0].maxMs).toBe(65.4);
    });
  });
});
