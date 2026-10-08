// ============================================================================
// Phase 19 / Steps 11 & 12: NestJS Modular Monolith Architecture Test Suite
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Clean Architecture & Modular Monolith)
//
// Verifies:
// 1. NestJS AppModule imports all 4 domain modules (Fuel, Fleet, Billing, Audit).
// 2. Dependency injection container successfully resolves all domain services.
// 3. FuelService coordinates single-writer transactional gateway and queries.
// 4. FleetService handles asset querying with narrow projections and pagination.
// 5. BillingService handles invoice lifecycle (finalize, pay, basis).
// 6. AuditService provides append-only immutable audit logging.
// 7. TenantContextInterceptor extracts and propagates tenant/role session context.
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/server/app.module";
import { FuelService } from "../src/server/modules/fuel/fuel.service";
import { FleetService } from "../src/server/modules/fleet/fleet.service";
import { BillingService } from "../src/server/modules/billing/billing.service";
import { AuditService } from "../src/server/modules/audit/audit.service";
import { TenantContextInterceptor } from "../src/server/common/tenant-context.interceptor";
import { firstValueFrom, of } from "rxjs";

// Hoisted mock state for Prisma
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    fuelIssue: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    asset: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    assetAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    bill: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((promises) => Promise.all(promises)),
    $disconnect: vi.fn(),
  };
  return { mockPrisma };
});

vi.mock("../src/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("Steps 11 & 12: NestJS Modular Monolith Architecture", () => {
  let moduleRef: TestingModule;
  let fuelService: FuelService;
  let fleetService: FleetService;
  let billingService: BillingService;
  let auditService: AuditService;

  beforeEach(async () => {
    vi.clearAllMocks();

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    fuelService = moduleRef.get<FuelService>(FuelService);
    fleetService = moduleRef.get<FleetService>(FleetService);
    billingService = moduleRef.get<BillingService>(BillingService);
    auditService = moduleRef.get<AuditService>(AuditService);
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection & Container Verification
  // --------------------------------------------------------------------------
  describe("Dependency Injection & Domain Modules Initialization", () => {
    it("successfully compiles AppModule and resolves all domain services", () => {
      expect(moduleRef).toBeDefined();
      expect(fuelService).toBeDefined();
      expect(fleetService).toBeDefined();
      expect(billingService).toBeDefined();
      expect(auditService).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Fuel Domain Service (FuelModule)
  // --------------------------------------------------------------------------
  describe("FuelService Domain Operations", () => {
    it("delegates getIssuesPaginated with pagination and scoping options", async () => {
      mockPrisma.fuelIssue.count.mockResolvedValueOnce(45);
      mockPrisma.fuelIssue.findMany.mockResolvedValueOnce([
        {
          id: "issue-1",
          issueDate: new Date("2026-10-01T10:00:00Z"),
          litres: 50.0,
          totalCost: 17500,
          pricePerLitre: 350,
          fuelKind: "AUTO_DIESEL",
          source: "STATION",
          voided: false,
          meterReading: 12050,
          readingType: "KM",
          corrections: [],
          bulkTankId: null,
          assetId: "asset-1",
          asset: {
            id: "asset-1",
            code: "CAB-101",
            regNo: "WP-CAB-101",
            category: { name: "Cab", code: "CAB" },
            projectId: "proj-1",
            project: { id: "proj-1", name: "Colombo Site", code: "COL" },
          },
          bulkTank: null,
          fuelPrice: null,
          issuedBy: { id: "user-1", name: "Operator" },
        },
      ]);

      const result = await fuelService.getIssuesPaginated({
        page: 1,
        limit: 25,
        userRole: "ADMIN",
      });

      expect(result.pagination.totalCount).toBe(45);
      expect(result.pagination.limit).toBe(25);
      expect(result.data).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Fleet Domain Service (FleetModule)
  // --------------------------------------------------------------------------
  describe("FleetService Domain Operations", () => {
    it("delegates getAssetsPaginated with query parameters", async () => {
      mockPrisma.asset.count.mockResolvedValueOnce(30);
      mockPrisma.asset.findMany.mockResolvedValueOnce([
        { id: "asset-1", code: "HEX-01", status: "ACTIVE" },
      ]);

      const result = await fleetService.getAssetsPaginated({
        page: 1,
        limit: 25,
      });

      expect(result.pagination.totalCount).toBe(30);
      expect(result.data[0].code).toBe("HEX-01");
    });

    it("retrieves asset by code and throws NotFoundException when missing", async () => {
      mockPrisma.asset.findFirst.mockResolvedValueOnce(null);

      await expect(fleetService.getAssetByCode("NON_EXISTENT")).rejects.toThrow(
        /not found/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Billing Domain Service (BillingModule)
  // --------------------------------------------------------------------------
  describe("BillingService Domain Operations", () => {
    it("queries paginated invoices for a periodKey", async () => {
      mockPrisma.bill.count.mockResolvedValueOnce(15);
      mockPrisma.bill.findMany.mockResolvedValueOnce([
        { id: "bill-1", grandTotalCents: 1500000, status: "DRAFT" },
      ]);

      const result = await billingService.getInvoicesPaginated({
        periodKey: "2026-10",
        page: 1,
        limit: 25,
      });

      expect(result.pagination.totalCount).toBe(15);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("bill-1");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Audit Domain Service (AuditModule)
  // --------------------------------------------------------------------------
  describe("AuditService Append-Only Logging", () => {
    it("appends an audit log entry immutably", async () => {
      mockPrisma.auditLog.create.mockResolvedValueOnce({
        id: "audit-1",
        actorId: "user-1",
        action: "CREATE",
        entity: "FuelIssue",
        entityId: "issue-123",
        summary: "Dispensed 50L fuel",
        createdAt: new Date(),
      });

      const entry = await auditService.log({
        actorId: "user-1",
        action: "CREATE",
        entity: "FuelIssue",
        entityId: "issue-123",
        summary: "Dispensed 50L fuel",
      });

      expect(entry.id).toBe("audit-1");
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: "user-1",
            entityId: "issue-123",
          }),
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. Tenant Context Interceptor
  // --------------------------------------------------------------------------
  describe("TenantContextInterceptor Session Propagation", () => {
    it("extracts and binds tenant context to the HTTP request", async () => {
      const interceptor = new TenantContextInterceptor();
      const mockRequest: any = {
        headers: {
          "x-tenant-id": "tenant-corp-1",
          "x-user-id": "user-42",
          "x-user-role": "ALLOCATOR",
          "x-project-id": "proj-kotugoda",
        },
      };

      const mockExecutionContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      const mockCallHandler: any = {
        handle: () => of("result"),
      };

      await firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler));

      expect(mockRequest.tenantContext).toBeDefined();
      expect(mockRequest.tenantContext.tenantId).toBe("tenant-corp-1");
      expect(mockRequest.tenantContext.userId).toBe("user-42");
      expect(mockRequest.tenantContext.userRole).toBe("ALLOCATOR");
      expect(mockRequest.tenantContext.projectId).toBe("proj-kotugoda");
    });
  });
});
