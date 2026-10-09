// ============================================================================
// Phase 19 / Wave F: Procurement & Supplier Receipt Domain Test Suite
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Tests:
// 1. NestJS Dependency Injection resolution for ProcurementModule
// 2. Purchase Order creation and cost calculation
// 3. Role-based PO approval and outbox event publishing
// 4. Goods Receipt Note (GRN) recording with thermal temperature adjustments
// 5. Partial receipt tracking and PO lifecycle state progression
// 6. Three-Way Matching reconciliation engine (Perfect, Tolerance, Discrepancy)
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "@/server/app.module";
import { ProcurementService } from "@/server/modules/procurement/procurement.service";
import { ProcurementController } from "@/server/modules/procurement/procurement.controller";
import {
  setKafkaBroker,
  InMemoryKafkaBroker,
} from "@/lib/events/kafka-producer";
import { ForbiddenException, BadRequestException } from "@nestjs/common";

// Mock Prisma for clean test isolation
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("Wave F: Procurement & Supplier Receipt Domain Module", () => {
  let moduleRef: TestingModule;
  let procurementService: ProcurementService;
  let procurementController: ProcurementController;
  let kafkaBroker: InMemoryKafkaBroker;

  beforeEach(async () => {
    vi.clearAllMocks();
    kafkaBroker = new InMemoryKafkaBroker();
    setKafkaBroker(kafkaBroker);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    procurementService = moduleRef.get<ProcurementService>(ProcurementService);
    procurementController = moduleRef.get<ProcurementController>(ProcurementController);
    procurementService.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection Resolution
  // --------------------------------------------------------------------------
  describe("1. NestJS DI Container Resolution", () => {
    it("successfully resolves ProcurementService and ProcurementController from AppModule", () => {
      expect(procurementService).toBeDefined();
      expect(procurementController).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Purchase Order Lifecycle
  // --------------------------------------------------------------------------
  describe("2. Purchase Order Lifecycle", () => {
    it("creates a purchase order in DRAFT status with calculated totals", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-ceypetco",
          supplierName: "Ceylon Petroleum Corporation",
          siteId: "site-colombo-north",
          currency: "LKR",
          lineItems: [
            {
              itemCategory: "FUEL",
              itemCode: "DIESEL-AUTO",
              description: "Auto Diesel Bulk Delivery",
              orderedQuantity: 6600,
              unit: "LITERS",
              unitPriceCents: 37000, // 370.00 LKR
            },
            {
              itemCategory: "LUBRICANT",
              itemCode: "LUB-15W40",
              description: "Engine Oil 15W40 20L Drum",
              orderedQuantity: 5,
              unit: "DRUMS",
              unitPriceCents: 2500000, // 25,000.00 LKR
            },
          ],
        },
        "purchasing-officer-1"
      );

      expect(po.id).toBeDefined();
      expect(po.poNumber).toMatch(/^PO-2026-\d+$/);
      expect(po.status).toBe("DRAFT");
      expect(po.lineItems).toHaveLength(2);

      // Total amount: (6600 * 37000) + (5 * 2500000) = 244,200,000 + 12,500,000 = 256,700,000 cents
      expect(po.totalAmountCents).toBe(256700000);
      expect(po.lineItems[0].receivedQuantity).toBe(0);
    });

    it("rejects invalid line items with negative prices or zero quantities", async () => {
      await expect(
        procurementService.createPurchaseOrder(
          {
            supplierId: "supp-1",
            supplierName: "Test Supplier",
            siteId: "site-1",
            lineItems: [
              {
                itemCategory: "FUEL",
                itemCode: "DIESEL",
                description: "Diesel",
                orderedQuantity: 0, // Invalid: zero
                unit: "L",
                unitPriceCents: 37000,
              },
            ],
          },
          "user-1"
        )
      ).rejects.toThrow(BadRequestException);
    });

    it("enforces RBAC on purchase order approval (allows ADMIN, rejects VIEWER)", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-1",
          supplierName: "Test Supplier",
          siteId: "site-1",
          lineItems: [
            {
              itemCategory: "FUEL",
              itemCode: "DIESEL",
              description: "Diesel",
              orderedQuantity: 1000,
              unit: "L",
              unitPriceCents: 37000,
            },
          ],
        },
        "user-1"
      );

      // Rejects VIEWER
      await expect(
        procurementService.approvePurchaseOrder(po.id, "viewer-1", "VIEWER")
      ).rejects.toThrow(ForbiddenException);

      // Approves by ADMIN
      const approved = await procurementService.approvePurchaseOrder(
        po.id,
        "admin-1",
        "ADMIN"
      );

      expect(approved.status).toBe("APPROVED");
      expect(approved.approvedBy).toBe("admin-1");
      expect(approved.approvedAt).toBeInstanceOf(Date);

      // Emits outbox event to Kafka broker
      const published = kafkaBroker.getPublishedMessages();
      expect(published).toHaveLength(1);
      const event = JSON.parse(published[0].value);
      expect(event.eventType).toBe("ProcurementOrderApproved");
      expect(event.poId).toBe(po.id);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Goods Receipt Notes (GRN) & Physical Bowser Delivery
  // --------------------------------------------------------------------------
  describe("3. Goods Receipt Notes (GRN) & Delivery Verification", () => {
    it("records goods receipt with batch ticket number and thermal normalization", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-ceypetco",
          supplierName: "Ceylon Petroleum Corporation",
          siteId: "site-badalgama",
          lineItems: [
            {
              itemCategory: "FUEL",
              itemCode: "DIESEL-AUTO",
              description: "Auto Diesel",
              orderedQuantity: 6600,
              unit: "LITERS",
              unitPriceCents: 37000,
            },
          ],
        },
        "purchasing-officer-1"
      );

      await procurementService.approvePurchaseOrder(po.id, "manager-1", "MANAGER");

      // Physical delivery at 30 deg C (tropical site temperature)
      // V15 = 6600 * (1 - 0.00095 * (30 - 15)) = 6600 * (1 - 0.01425) = 6600 * 0.98575 = 6505.95 L
      const grn = await procurementService.recordGoodsReceipt(
        {
          purchaseOrderId: po.id,
          siteId: "site-badalgama",
          tankId: "tank-main-1",
          batchTicketNumber: "CEY-TKT-88491",
          items: [
            {
              poLineId: po.lineItems[0].id,
              itemCode: "DIESEL-AUTO",
              deliveredQuantity: 6600,
              unit: "LITERS",
              temperatureC: 30,
              density: 0.835,
            },
          ],
        },
        "fuel-manager-site"
      );

      expect(grn.grnNumber).toMatch(/^GRN-2026-\d+$/);
      expect(grn.batchTicketNumber).toBe("CEY-TKT-88491");
      expect(grn.items[0].acceptedQuantity).toBe(6505.95);
      expect(grn.totalAcceptedQuantity).toBe(6505.95);

      // Verify PO status updated to PARTIALLY_RECEIVED (due to net thermal contraction)
      const updatedPo = await procurementService.getPurchaseOrder(po.id);
      expect(updatedPo?.status).toBe("PARTIALLY_RECEIVED");
    });

    it("rejects goods receipt if purchase order is still in DRAFT status", async () => {
      const draftPo = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-1",
          supplierName: "Supplier",
          siteId: "site-1",
          lineItems: [
            {
              itemCategory: "FILTER",
              itemCode: "FLT-001",
              description: "Oil Filter",
              orderedQuantity: 10,
              unit: "PCS",
              unitPriceCents: 500000,
            },
          ],
        },
        "user-1"
      );

      await expect(
        procurementService.recordGoodsReceipt(
          {
            purchaseOrderId: draftPo.id,
            siteId: "site-1",
            batchTicketNumber: "TKT-101",
            items: [
              {
                poLineId: draftPo.lineItems[0].id,
                itemCode: "FLT-001",
                deliveredQuantity: 10,
                unit: "PCS",
              },
            ],
          },
          "receiver-1"
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Three-Way Reconciliation Matching
  // --------------------------------------------------------------------------
  describe("4. Three-Way Reconciliation Matching", () => {
    it("reports PERFECT_MATCH when delivered quantities and pricing match 100%", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-filters",
          supplierName: "Filter Distributors Ltd",
          siteId: "site-colombo",
          lineItems: [
            {
              itemCategory: "FILTER",
              itemCode: "LF16015",
              description: "Fleetguard Lube Filter",
              orderedQuantity: 20,
              unit: "PCS",
              unitPriceCents: 450000, // 4,500.00 LKR
            },
          ],
        },
        "buyer-1"
      );

      await procurementService.approvePurchaseOrder(po.id, "admin-1", "ADMIN");

      const grn = await procurementService.recordGoodsReceipt(
        {
          purchaseOrderId: po.id,
          siteId: "site-colombo",
          batchTicketNumber: "INV-FLT-2026-01",
          items: [
            {
              poLineId: po.lineItems[0].id,
              itemCode: "LF16015",
              deliveredQuantity: 20,
              unit: "PCS",
            },
          ],
        },
        "storekeeper-1"
      );

      const match = await procurementService.performThreeWayMatch(po.id, grn.id);

      expect(match.matchStatus).toBe("PERFECT_MATCH");
      expect(match.varianceCents).toBe(0);
      expect(match.variancePercentage).toBe(0);
      expect(match.discrepancies).toHaveLength(0);
    });

    it("reports TOLERANCE_ACCEPTED when fuel receipt is within petroleum tolerance (0.5%)", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-ceypetco",
          supplierName: "CPC",
          siteId: "site-badalgama",
          lineItems: [
            {
              itemCategory: "FUEL",
              itemCode: "DIESEL",
              description: "Diesel",
              orderedQuantity: 10000,
              unit: "LITERS",
              unitPriceCents: 37000,
            },
          ],
        },
        "buyer-1"
      );

      await procurementService.approvePurchaseOrder(po.id, "admin-1", "ADMIN");

      // 10,030 L delivered (+0.3% variance, within 0.5% tolerance)
      const grn = await procurementService.recordGoodsReceipt(
        {
          purchaseOrderId: po.id,
          siteId: "site-badalgama",
          batchTicketNumber: "CEY-TKT-9912",
          items: [
            {
              poLineId: po.lineItems[0].id,
              itemCode: "DIESEL",
              deliveredQuantity: 10030,
              unit: "LITERS",
            },
          ],
        },
        "receiver-1"
      );

      const match = await procurementService.performThreeWayMatch(po.id, grn.id, 0.5);

      expect(match.matchStatus).toBe("TOLERANCE_ACCEPTED");
      expect(match.variancePercentage).toBe(0.3);
      expect(match.discrepancies).toHaveLength(0);
    });

    it("flags DISCREPANCY when delivered quantity exceeds allowed tolerance", async () => {
      const po = await procurementService.createPurchaseOrder(
        {
          supplierId: "supp-ceypetco",
          supplierName: "CPC",
          siteId: "site-badalgama",
          lineItems: [
            {
              itemCategory: "FUEL",
              itemCode: "DIESEL",
              description: "Diesel",
              orderedQuantity: 10000,
              unit: "LITERS",
              unitPriceCents: 37000,
            },
          ],
        },
        "buyer-1"
      );

      await procurementService.approvePurchaseOrder(po.id, "admin-1", "ADMIN");

      // 9,800 L delivered (-2.0% variance, exceeds 0.5% tolerance)
      const grn = await procurementService.recordGoodsReceipt(
        {
          purchaseOrderId: po.id,
          siteId: "site-badalgama",
          batchTicketNumber: "CEY-TKT-SHORTFALL",
          items: [
            {
              poLineId: po.lineItems[0].id,
              itemCode: "DIESEL",
              deliveredQuantity: 9800,
              unit: "LITERS",
            },
          ],
        },
        "receiver-1"
      );

      const match = await procurementService.performThreeWayMatch(po.id, grn.id, 0.5);

      expect(match.matchStatus).toBe("DISCREPANCY");
      expect(match.discrepancies).toHaveLength(1);
      expect(match.discrepancies[0].reason).toContain("exceeds allowed tolerance 0.5%");
    });
  });
});
