// ============================================================================
// Phase 19 / Wave F: Equipment Maintenance & Work Order Costing Test Suite
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Tests:
// 1. NestJS Dependency Injection resolution for MaintenanceModule
// 2. Work Order lifecycle (OPEN -> IN_PROGRESS -> COMPLETED -> CLOSED)
// 3. Three-Pillar equipment costing (Labor + Parts + Sublet)
// 4. Role-based supervisor sign-off and closure guards
// 5. Preventative Maintenance (PM) meter trigger evaluations
// 6. Asset-level maintenance expenditure rollups
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "@/server/app.module";
import { MaintenanceService } from "@/server/modules/maintenance/maintenance.service";
import { MaintenanceController } from "@/server/modules/maintenance/maintenance.controller";
import {
  setKafkaBroker,
  InMemoryKafkaBroker,
} from "@/lib/events/kafka-producer";
import { ForbiddenException, BadRequestException } from "@nestjs/common";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("Wave F: Equipment Maintenance & Work Order Domain Module", () => {
  let moduleRef: TestingModule;
  let maintenanceService: MaintenanceService;
  let maintenanceController: MaintenanceController;
  let kafkaBroker: InMemoryKafkaBroker;

  beforeEach(async () => {
    vi.clearAllMocks();
    kafkaBroker = new InMemoryKafkaBroker();
    setKafkaBroker(kafkaBroker);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    maintenanceService = moduleRef.get<MaintenanceService>(MaintenanceService);
    maintenanceController = moduleRef.get<MaintenanceController>(MaintenanceController);
    maintenanceService.clear();

    // Register standard PM service rules
    maintenanceService.registerPMRule({
      id: "pm-rule-250",
      category: "EXCAVATOR",
      serviceName: "PM 250hr Service",
      intervalHours: 250,
      requiredParts: [
        { itemCode: "FLT-LF16015", quantity: 1 },
        { itemCode: "LUB-15W40-20L", quantity: 1 },
      ],
    });

    maintenanceService.registerPMRule({
      id: "pm-rule-500",
      category: "EXCAVATOR",
      serviceName: "PM 500hr Service",
      intervalHours: 500,
    });
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection Resolution
  // --------------------------------------------------------------------------
  describe("1. NestJS DI Container Resolution", () => {
    it("successfully resolves MaintenanceService and MaintenanceController from AppModule", () => {
      expect(maintenanceService).toBeDefined();
      expect(maintenanceController).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Work Order Creation & Event Outbox
  // --------------------------------------------------------------------------
  describe("2. Work Order Creation Lifecycle", () => {
    it("creates a work order in OPEN status with zero costs and emits outbox event", async () => {
      const wo = await maintenanceService.createWorkOrder(
        {
          assetId: "veh-excavator-cat-320",
          assetCode: "CAT-320D",
          siteId: "site-badalgama",
          type: "PREVENTATIVE",
          priority: "NORMAL",
          description: "Routine 250-hour preventative maintenance service",
          meterAtCreation: 2480,
          assignedTechnician: "lead-tech-kamal",
        },
        "workshop-supervisor-1"
      );

      expect(wo.id).toBeDefined();
      expect(wo.workOrderNumber).toMatch(/^WO-2026-\d+$/);
      expect(wo.status).toBe("OPEN");
      expect(wo.meterAtCreation).toBe(2480);
      expect(wo.totalLaborCostCents).toBe(0);
      expect(wo.totalPartsCostCents).toBe(0);
      expect(wo.totalSubletCostCents).toBe(0);
      expect(wo.totalCostCents).toBe(0);

      // Verify Kafka event published
      const published = kafkaBroker.getPublishedMessages();
      expect(published).toHaveLength(1);
      const event = JSON.parse(published[0].value);
      expect(event.eventType).toBe("WorkOrderCreated");
      expect(event.assetId).toBe("veh-excavator-cat-320");
    });

    it("rejects creation if meter reading is negative", async () => {
      await expect(
        maintenanceService.createWorkOrder(
          {
            assetId: "veh-1",
            siteId: "site-1",
            type: "BREAKDOWN",
            description: "Hydraulic leak",
            meterAtCreation: -50, // Invalid
          },
          "supervisor-1"
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Three-Pillar Equipment Costing (Labor + Parts + Sublet)
  // --------------------------------------------------------------------------
  describe("3. Three-Pillar Equipment Costing", () => {
    it("aggregates labor, parts, and sublet costs into total maintenance expenditure", async () => {
      const wo = await maintenanceService.createWorkOrder(
        {
          assetId: "veh-bowser-isuzu",
          siteId: "site-colombo",
          type: "BREAKDOWN",
          priority: "HIGH",
          description: "Clutch slippage and brake booster overhaul",
          meterAtCreation: 184500,
        },
        "supervisor-1"
      );

      // 1. Log Labor: 4.5 hours at 1,500.00 LKR/hr = 675,000 cents
      await maintenanceService.addLabor(wo.id, {
        technicianId: "tech-sunil",
        technicianName: "Sunil Perera",
        hours: 4.5,
        hourlyRateCents: 150000,
        notes: "Dismantled transmission and replaced clutch plate",
      });

      // 2. Log Parts: Clutch kit (45,000.00 LKR = 4,500,000 cents) + Brake fluid (2 x 1,800.00 = 360,000 cents)
      await maintenanceService.addPartConsumed(wo.id, {
        itemCode: "PART-CLUTCH-ISZ",
        description: "Isuzu Heavy Duty Clutch Kit",
        quantity: 1,
        unitCostCents: 4500000,
      });

      await maintenanceService.addPartConsumed(wo.id, {
        itemCode: "LUB-DOT4-1L",
        description: "Brake Fluid DOT4 1L",
        quantity: 2,
        unitCostCents: 180000,
      });

      // 3. Log Sublet: Flywheel skimming at external machine shop (8,500.00 LKR = 850,000 cents)
      await maintenanceService.addSublet(wo.id, {
        vendorName: "Precision Engineering Works",
        serviceDescription: "Flywheel resurfacing and pilot bearing fitment",
        invoiceNumber: "INV-PEW-991",
        costCents: 850000,
      });

      const updatedWo = await maintenanceService.getWorkOrder(wo.id);
      expect(updatedWo).toBeDefined();
      expect(updatedWo?.status).toBe("IN_PROGRESS");

      // Verify individual cost pillars
      expect(updatedWo?.totalLaborCostCents).toBe(675000); // 6,750.00 LKR
      expect(updatedWo?.totalPartsCostCents).toBe(4500000 + 360000); // 48,600.00 LKR
      expect(updatedWo?.totalSubletCostCents).toBe(850000); // 8,500.00 LKR

      // Total cost: 675,000 + 4,860,000 + 850,000 = 6,385,000 cents (63,850.00 LKR)
      expect(updatedWo?.totalCostCents).toBe(6385000);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Work Order Completion & Closure Guards
  // --------------------------------------------------------------------------
  describe("4. Completion & Supervisor Closure Controls", () => {
    it("completes work order, emits event, and enforces supervisor authorization for closure", async () => {
      const wo = await maintenanceService.createWorkOrder(
        {
          assetId: "veh-roller-cat",
          siteId: "site-badalgama",
          type: "PREVENTATIVE",
          description: "Routine servicing",
          meterAtCreation: 1200,
        },
        "supervisor-1"
      );

      // Complete work order
      const completed = await maintenanceService.completeWorkOrder(
        wo.id,
        { meterAtCompletion: 1202, notes: "All fluids checked and filters replaced" },
        "technician-1"
      );

      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.meterAtCompletion).toBe(1202);

      // Rejects non-manager/supervisor role attempting to close
      await expect(
        maintenanceService.closeWorkOrder(wo.id, "tech-1", "DISPENSER")
      ).rejects.toThrow(ForbiddenException);

      // Successfully closed by ADMIN / MANAGER
      const closed = await maintenanceService.closeWorkOrder(
        wo.id,
        "manager-1",
        "MANAGER",
        { supervisorNotes: "Job inspected and approved for site release" }
      );

      expect(closed.status).toBe("CLOSED");
      expect(closed.closedBy).toBe("manager-1");
      expect(closed.closedAt).toBeInstanceOf(Date);
      expect(closed.notes).toContain("Signoff: Job inspected and approved for site release");

      // Once closed, cannot add more labor or parts
      await expect(
        maintenanceService.addLabor(wo.id, {
          technicianId: "tech-1",
          technicianName: "Tech",
          hours: 1,
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Preventative Maintenance (PM) Trigger Engine
  // --------------------------------------------------------------------------
  describe("5. Preventative Maintenance (PM) Trigger Evaluation", () => {
    it("identifies when equipment is approaching vs overdue for PM service", () => {
      // Rule 250hr: last service at 1000hr, next due at 1250hr

      // Case A: At 1180hr -> Not overdue, 70 hours remaining
      const evalNormal = maintenanceService.evaluatePMTriggers(
        "veh-cat-320",
        "CAT-320",
        1180,
        1000
      );

      const pm250Normal = evalNormal.find((e) => e.pmRuleName === "PM 250hr Service");
      expect(pm250Normal).toBeDefined();
      expect(pm250Normal?.isOverdue).toBe(false);
      expect(pm250Normal?.nextDueMeter).toBe(1250);
      expect(pm250Normal?.hoursRemaining).toBe(70);

      // Case B: At 1265hr -> Overdue by 15 hours!
      const evalOverdue = maintenanceService.evaluatePMTriggers(
        "veh-cat-320",
        "CAT-320",
        1265,
        1000
      );

      const pm250Overdue = evalOverdue.find((e) => e.pmRuleName === "PM 250hr Service");
      expect(pm250Overdue?.isOverdue).toBe(true);
      expect(pm250Overdue?.hoursRemaining).toBe(-15);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Equipment Lifetime Maintenance Cost Aggregation
  // --------------------------------------------------------------------------
  describe("6. Equipment Lifetime Maintenance Expenditure Rollup", () => {
    it("aggregates multi-work order repair costs for asset profitability analysis", async () => {
      const assetId = "veh-tipper-001";

      // Work Order 1: 5,000 LKR labor + 12,000 LKR parts = 17,000 LKR (1,700,000 cents)
      const wo1 = await maintenanceService.createWorkOrder(
        { assetId, siteId: "site-1", type: "PREVENTATIVE", description: "Service 1", meterAtCreation: 50000 },
        "sup-1"
      );
      await maintenanceService.addLabor(wo1.id, { technicianId: "t1", technicianName: "T1", hours: 2, hourlyRateCents: 250000 });
      await maintenanceService.addPartConsumed(wo1.id, { itemCode: "FLT-1", description: "Oil Filter", quantity: 1, unitCostCents: 1200000 });

      // Work Order 2: 10,000 LKR sublet (1,000,000 cents)
      const wo2 = await maintenanceService.createWorkOrder(
        { assetId, siteId: "site-1", type: "BREAKDOWN", description: "Radiator repair", meterAtCreation: 52000 },
        "sup-1"
      );
      await maintenanceService.addSublet(wo2.id, { vendorName: "Radiator Shop", serviceDescription: "Recore", costCents: 1000000 });

      const rollup = await maintenanceService.getAssetTotalMaintenanceCost(assetId);

      expect(rollup.workOrdersCount).toBe(2);
      expect(rollup.totalLaborCostCents).toBe(500000);
      expect(rollup.totalPartsCostCents).toBe(1200000);
      expect(rollup.totalSubletCostCents).toBe(1000000);
      expect(rollup.totalCostCents).toBe(2700000); // 27,000.00 LKR
    });
  });
});
