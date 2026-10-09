// ============================================================================
// Phase 19 / Wave F: Multi-Site Inventory & Stock Movement Test Suite
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Tests:
// 1. NestJS Dependency Injection resolution for InventoryModule
// 2. Stock intake receipt and ledger tracking
// 3. Direct issue-to-asset costing and Kafka event emission
// 4. Inter-site transfer dispatch, in-transit status, and receipt acknowledgment
// 5. Physical stock audit adjustments with RBAC controls
// 6. Automated reorder threshold alerting
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "@/server/app.module";
import { InventoryService } from "@/server/modules/inventory/inventory.service";
import { InventoryController } from "@/server/modules/inventory/inventory.controller";
import {
  setKafkaBroker,
  InMemoryKafkaBroker,
} from "@/lib/events/kafka-producer";
import { ForbiddenException, BadRequestException, NotFoundException } from "@nestjs/common";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("Wave F: Multi-Site Inventory & Stock Issue Domain Module", () => {
  let moduleRef: TestingModule;
  let inventoryService: InventoryService;
  let inventoryController: InventoryController;
  let kafkaBroker: InMemoryKafkaBroker;

  beforeEach(async () => {
    vi.clearAllMocks();
    kafkaBroker = new InMemoryKafkaBroker();
    setKafkaBroker(kafkaBroker);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    inventoryService = moduleRef.get<InventoryService>(InventoryService);
    inventoryController = moduleRef.get<InventoryController>(InventoryController);
    inventoryService.clear();

    // Seed master catalog item and locations
    inventoryService.registerItem({
      id: "item-flt-1",
      itemCode: "FLT-LF16015",
      name: "Fleetguard Lube Filter",
      category: "FILTER",
      unit: "PCS",
      standardCostCents: 450000, // 4,500.00 LKR
      reorderThreshold: 10,
      reorderQuantity: 30,
    });

    inventoryService.registerItem({
      id: "item-lub-1",
      itemCode: "LUB-15W40-20L",
      name: "Mobil Delvac 15W40 Engine Oil 20L",
      category: "LUBRICANT",
      unit: "PAILS",
      standardCostCents: 2200000, // 22,000.00 LKR
      reorderThreshold: 5,
      reorderQuantity: 20,
    });

    inventoryService.registerLocation({
      id: "loc-central-wh",
      code: "WH-CENTRAL",
      name: "Colombo Central Workshop",
      siteId: "site-colombo",
      isMobile: false,
    });

    inventoryService.registerLocation({
      id: "loc-badalgama-store",
      code: "STORE-BADALGAMA",
      name: "Badalgama Site Store",
      siteId: "site-badalgama",
      isMobile: false,
    });
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection Resolution
  // --------------------------------------------------------------------------
  describe("1. NestJS DI Container Resolution", () => {
    it("successfully resolves InventoryService and InventoryController from AppModule", () => {
      expect(inventoryService).toBeDefined();
      expect(inventoryController).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Stock Intake & Ledger Tracking
  // --------------------------------------------------------------------------
  describe("2. Stock Intake & Append-Only Ledger", () => {
    it("receives stock into a location and logs append-only ledger entry", async () => {
      const level = await inventoryService.receiveStock(
        "loc-central-wh",
        "FLT-LF16015",
        50,
        450000,
        "GRN-2026-5001",
        "storekeeper-1"
      );

      expect(level.quantityOnHand).toBe(50);
      expect(level.quantityAvailable).toBe(50);

      const ledger = await inventoryService.getLedgerEntries({
        itemCode: "FLT-LF16015",
        locationId: "loc-central-wh",
      });

      expect(ledger).toHaveLength(1);
      expect(ledger[0].movementType).toBe("RECEIPT");
      expect(ledger[0].quantity).toBe(50);
      expect(ledger[0].totalCostCents).toBe(50 * 450000);
      expect(ledger[0].referenceId).toBe("GRN-2026-5001");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Direct Issue to Asset Costing
  // --------------------------------------------------------------------------
  describe("3. Direct Issue-to-Asset Costing", () => {
    it("issues filters to a fleet asset with work order reference and emits event", async () => {
      await inventoryService.receiveStock(
        "loc-central-wh",
        "FLT-LF16015",
        20,
        450000
      );

      const entry = await inventoryService.issueStockToAsset(
        {
          locationId: "loc-central-wh",
          itemCode: "FLT-LF16015",
          quantity: 2,
          assetId: "veh-wp-cab-1234",
          workOrderId: "wo-pm-5000",
          notes: "Scheduled 250hr PM Service",
        },
        "mechanic-leader-1"
      );

      expect(entry.movementType).toBe("ISSUE_TO_ASSET");
      expect(entry.assetId).toBe("veh-wp-cab-1234");
      expect(entry.workOrderId).toBe("wo-pm-5000");
      expect(entry.quantity).toBe(2);
      expect(entry.totalCostCents).toBe(2 * 450000);

      const remaining = await inventoryService.getStockLevel("loc-central-wh", "FLT-LF16015");
      expect(remaining?.quantityOnHand).toBe(18);
      expect(remaining?.quantityAvailable).toBe(18);

      // Verify Kafka event published
      const published = kafkaBroker.getPublishedMessages();
      expect(published).toHaveLength(1);
      const event = JSON.parse(published[0].value);
      expect(event.eventType).toBe("StockIssued");
      expect(event.assetId).toBe("veh-wp-cab-1234");
      expect(event.quantity).toBe(2);
    });

    it("rejects issue request when requested quantity exceeds available stock", async () => {
      await inventoryService.receiveStock(
        "loc-central-wh",
        "FLT-LF16015",
        3,
        450000
      );

      await expect(
        inventoryService.issueStockToAsset(
          {
            locationId: "loc-central-wh",
            itemCode: "FLT-LF16015",
            quantity: 5, // Exceeds on-hand 3
            assetId: "veh-1",
          },
          "user-1"
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Inter-Site Warehouse Transfers
  // --------------------------------------------------------------------------
  describe("4. Inter-Site Warehouse Transfers", () => {
    it("dispatches transfer between locations and increments destination upon receipt", async () => {
      // 1. Central warehouse receives 40 oil pails
      await inventoryService.receiveStock(
        "loc-central-wh",
        "LUB-15W40-20L",
        40,
        2200000
      );

      // 2. Dispatch 15 pails to Badalgama store
      const transfer = await inventoryService.dispatchTransfer(
        {
          sourceLocationId: "loc-central-wh",
          destinationLocationId: "loc-badalgama-store",
          itemCode: "LUB-15W40-20L",
          quantity: 15,
          notes: "Replenish Badalgama lube store for excavator servicing",
        },
        "logistics-coordinator"
      );

      expect(transfer.transferNumber).toMatch(/^TRF-2026-\d+$/);
      expect(transfer.status).toBe("IN_TRANSIT");

      // Verify source stock immediately reduced
      const sourceStock = await inventoryService.getStockLevel("loc-central-wh", "LUB-15W40-20L");
      expect(sourceStock?.quantityAvailable).toBe(25);

      // Destination has not received yet
      const destBefore = await inventoryService.getStockLevel("loc-badalgama-store", "LUB-15W40-20L");
      expect(destBefore).toBeNull();

      // 3. Receive transfer at Badalgama site
      const received = await inventoryService.receiveTransfer(
        {
          transferId: transfer.id,
          quantityReceived: 15,
          notes: "Received intact by site storekeeper",
        },
        "site-storekeeper-badalgama"
      );

      expect(received.status).toBe("RECEIVED");
      expect(received.quantityReceived).toBe(15);
      expect(received.receivedBy).toBe("site-storekeeper-badalgama");

      // Destination stock now available
      const destAfter = await inventoryService.getStockLevel("loc-badalgama-store", "LUB-15W40-20L");
      expect(destAfter?.quantityAvailable).toBe(15);
    });

    it("rejects transfer dispatch between identical locations", async () => {
      await expect(
        inventoryService.dispatchTransfer(
          {
            sourceLocationId: "loc-central-wh",
            destinationLocationId: "loc-central-wh",
            itemCode: "LUB-15W40-20L",
            quantity: 5,
          },
          "user-1"
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Physical Stock Audit Adjustments
  // --------------------------------------------------------------------------
  describe("5. Stock Audit Adjustments & RBAC", () => {
    it("adjusts stock level and records audit variance when performed by ADMIN", async () => {
      await inventoryService.receiveStock(
        "loc-central-wh",
        "FLT-LF16015",
        20,
        450000
      );

      // Physical count finds 18 (2 filters broken/lost)
      const adjusted = await inventoryService.auditAdjustStock(
        {
          locationId: "loc-central-wh",
          itemCode: "FLT-LF16015",
          physicalCount: 18,
          reason: "Damaged in store during pallet move",
        },
        "auditor-1",
        "ADMIN"
      );

      expect(adjusted.quantityOnHand).toBe(18);
      expect(adjusted.quantityAvailable).toBe(18);

      const ledger = await inventoryService.getLedgerEntries({
        itemCode: "FLT-LF16015",
        locationId: "loc-central-wh",
      });

      const auditEntry = ledger.find((e) => e.movementType === "AUDIT_ADJUSTMENT");
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.quantity).toBe(-2);
      expect(auditEntry?.notes).toContain("Variance: -2");
    });

    it("rejects audit adjustments attempted by non-admin roles", async () => {
      await expect(
        inventoryService.auditAdjustStock(
          {
            locationId: "loc-central-wh",
            itemCode: "FLT-LF16015",
            physicalCount: 10,
            reason: "Attempt by unauthorized user",
          },
          "store-helper",
          "DISPENSER"
        )
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Automated Reorder Threshold Alerting
  // --------------------------------------------------------------------------
  describe("6. Automated Reorder Threshold Alerting", () => {
    it("generates replenishment alert when available stock dips to or below reorder threshold", async () => {
      // Reorder threshold for FLT-LF16015 is 10, reorder quantity is 30
      await inventoryService.receiveStock(
        "loc-central-wh",
        "FLT-LF16015",
        12,
        450000
      );

      // Above threshold -> No alert
      let alerts = await inventoryService.checkReorderAlerts("loc-central-wh");
      expect(alerts).toHaveLength(0);

      // Issue 4 -> Available becomes 8 (below threshold of 10)
      await inventoryService.issueStockToAsset(
        {
          locationId: "loc-central-wh",
          itemCode: "FLT-LF16015",
          quantity: 4,
          assetId: "veh-1",
        },
        "mech-1"
      );

      alerts = await inventoryService.checkReorderAlerts("loc-central-wh");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].itemCode).toBe("FLT-LF16015");
      expect(alerts[0].currentAvailable).toBe(8);
      expect(alerts[0].reorderThreshold).toBe(10);
      expect(alerts[0].suggestedReorderQuantity).toBe(30);
      expect(alerts[0].estimatedCostCents).toBe(30 * 450000);
    });
  });
});
