// ============================================================================
// Phase 19 / Wave F: General Ledger (GL) Export & ERP Integration Test Suite
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Tests:
// 1. NestJS Dependency Injection resolution for IntegrationModule
// 2. Double-entry journal line generation across Fuel, Receipts, Billing, and Payments
// 3. Strict zero-imbalance trial balance validation (sum(Debits) == sum(Credits))
// 4. Corporate ERP CSV export format (SAP / Oracle / QuickBooks compatibility)
// 5. Structured JSON export serialization
// 6. Kafka event egress on journal batch export
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "@/server/app.module";
import { GLExportService } from "@/server/modules/integration/gl-export.service";
import { GLExportController } from "@/server/modules/integration/gl-export.controller";
import {
  setKafkaBroker,
  InMemoryKafkaBroker,
} from "@/lib/events/kafka-producer";
import { BadRequestException, NotFoundException } from "@nestjs/common";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("Wave F: General Ledger (GL) Export & ERP Integration Module", () => {
  let moduleRef: TestingModule;
  let glExportService: GLExportService;
  let glExportController: GLExportController;
  let kafkaBroker: InMemoryKafkaBroker;

  beforeEach(async () => {
    vi.clearAllMocks();
    kafkaBroker = new InMemoryKafkaBroker();
    setKafkaBroker(kafkaBroker);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    glExportService = moduleRef.get<GLExportService>(GLExportService);
    glExportController = moduleRef.get<GLExportController>(GLExportController);
    glExportService.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection Resolution
  // --------------------------------------------------------------------------
  describe("1. NestJS DI Container Resolution", () => {
    it("successfully resolves GLExportService and GLExportController from AppModule", () => {
      expect(glExportService).toBeDefined();
      expect(glExportController).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Double-Entry Journal Generation & Balancing
  // --------------------------------------------------------------------------
  describe("2. Double-Entry Journal Generation", () => {
    it("generates perfectly balanced double-entry journals for monthly transactions", async () => {
      const batch = await glExportService.generateJournalBatch(
        {
          period: "2026-08",
          sourceModule: "COMBINED",
          fuelIssues: [
            { id: "iss-1", costCents: 15000000, assetId: "veh-bowser-1" }, // 150,000.00 LKR
            { id: "iss-2", costCents: 25000000, assetId: "veh-excavator-2" }, // 250,000.00 LKR
          ],
          fuelReceipts: [
            { id: "grn-1", costCents: 40000000, supplierId: "supp-ceypetco" }, // 400,000.00 LKR
          ],
          invoices: [
            { id: "bill-101", hireCents: 50000000, fuelCents: 15000000, customerId: "cust-maga" }, // 650,000.00 LKR
          ],
          payments: [
            { id: "pmt-55", amountCents: 65000000, customerId: "cust-maga" }, // 650,000.00 LKR
          ],
          maintenanceWorkOrders: [
            { id: "wo-88", partsCostCents: 1200000, laborCostCents: 800000, assetId: "veh-bowser-1" }, // 20,000.00 LKR
          ],
        },
        "chief-accountant-1"
      );

      expect(batch.id).toBeDefined();
      expect(batch.batchNumber).toMatch(/^GL-202608-\d+$/);
      expect(batch.isBalanced).toBe(true);

      // Verify trial balance zero-variance
      expect(batch.totalDebitsCents).toBe(batch.totalCreditsCents);

      // Total debits breakdown:
      // Fuel Issues: 40,000,000
      // Fuel Receipts: 40,000,000
      // Invoices: 65,000,000
      // Payments: 65,000,000
      // Maintenance: 2,000,000
      // Sum = 212,000,000 cents (2,120,000.00 LKR)
      expect(batch.totalDebitsCents).toBe(212000000);
      expect(batch.totalCreditsCents).toBe(212000000);

      // Verify specific double-entry lines
      const fuelIssueDebits = batch.lines.filter((l) => l.accountCode === "5100");
      expect(fuelIssueDebits).toHaveLength(2);
      expect(fuelIssueDebits.reduce((acc, l) => acc + l.debitCents, 0)).toBe(40000000);

      const fuelInvCredits = batch.lines.filter((l) => l.accountCode === "1310" && l.creditCents > 0);
      expect(fuelInvCredits.reduce((acc, l) => acc + l.creditCents, 0)).toBe(40000000);

      const arDebits = batch.lines.filter((l) => l.accountCode === "1200" && l.debitCents > 0);
      expect(arDebits[0].debitCents).toBe(65000000);

      const hireRevCredits = batch.lines.filter((l) => l.accountCode === "4100");
      expect(hireRevCredits[0].creditCents).toBe(50000000);

      const fuelRevCredits = batch.lines.filter((l) => l.accountCode === "4200");
      expect(fuelRevCredits[0].creditCents).toBe(15000000);
    });

    it("rejects empty journal batch requests", async () => {
      await expect(
        glExportService.generateJournalBatch(
          { period: "2026-08" },
          "accountant-1"
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Corporate ERP CSV Export Formatting
  // --------------------------------------------------------------------------
  describe("3. Corporate ERP CSV Export Formatting", () => {
    it("serializes journal batch into standard CSV format with headers and emits outbox event", async () => {
      const batch = await glExportService.generateJournalBatch(
        {
          period: "2026-08",
          invoices: [
            { id: "bill-200", hireCents: 100000000, fuelCents: 20000000, customerId: "cust-access" },
          ],
        },
        "accountant-1"
      );

      const exportResult = await glExportService.exportBatchToCSV(batch.id);

      expect(exportResult.format).toBe("CSV");
      expect(exportResult.recordCount).toBe(3); // 1 Debit AR, 1 Credit Hire, 1 Credit Fuel
      expect(exportResult.csvContent).toBeDefined();

      const csvLines = exportResult.csvContent!.split("\n");
      // Line 0: Header
      expect(csvLines[0]).toBe("BatchNumber,Date,AccountCode,AccountName,Debit,Credit,Reference,Entity,Description");

      // Verify Debit AR line: 1,200,000.00 LKR
      const arLine = csvLines.find((l) => l.includes("1200"));
      expect(arLine).toContain("1200000.00,0.00,bill-200,cust-access");

      // Verify Credit Hire Revenue line: 1,000,000.00 LKR
      const hireLine = csvLines.find((l) => l.includes("4100"));
      expect(hireLine).toContain("0.00,1000000.00,bill-200,cust-access");

      // Verify Kafka event published
      const published = kafkaBroker.getPublishedMessages("billing.invoice.generated");
      expect(published).toHaveLength(1);
      const event = JSON.parse(published[0].value);
      expect(event.eventType).toBe("GLJournalBatchExported");
      expect(event.batchNumber).toBe(batch.batchNumber);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Structured JSON Export Serialization
  // --------------------------------------------------------------------------
  describe("4. Structured JSON Export Serialization", () => {
    it("exports batch as structured JSON for direct REST API integrations", async () => {
      const batch = await glExportService.generateJournalBatch(
        {
          period: "2026-08",
          payments: [
            { id: "pmt-99", amountCents: 50000000, customerId: "cust-access" },
          ],
        },
        "accountant-1"
      );

      const jsonResult = await glExportService.exportBatchToJSON(batch.id);

      expect(jsonResult.format).toBe("JSON");
      expect(jsonResult.jsonData).toBeDefined();
      expect(jsonResult.jsonData?.batchNumber).toBe(batch.batchNumber);
      expect(jsonResult.jsonData?.lines).toHaveLength(2);
      expect(jsonResult.jsonData?.isBalanced).toBe(true);
    });

    it("throws NotFoundException when exporting non-existent batch ID", async () => {
      await expect(
        glExportService.exportBatchToJSON("non-existent-batch-uuid")
      ).rejects.toThrow(NotFoundException);
    });
  });
});
