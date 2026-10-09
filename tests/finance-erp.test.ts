// ============================================================================
// Phase 19 / Wave F: Finance & Receivables Expansion Test Suite
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Tests:
// 1. NestJS Dependency Injection resolution for FinanceModule
// 2. Customer Credit Limit verification and Credit Hold guards
// 3. Multi-Invoice Lump-Sum FIFO Payment Allocation engine
// 4. Partial payments and unallocated customer credit balances
// 5. Financial Aging Schedule calculation across 30/60/90+ day buckets
// 6. Kafka event egress on payment allocations and credit hold changes
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "@/server/app.module";
import { FinanceService } from "@/server/modules/finance/finance.service";
import { FinanceController } from "@/server/modules/finance/finance.controller";
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

describe("Wave F: Finance & Receivables Domain Module", () => {
  let moduleRef: TestingModule;
  let financeService: FinanceService;
  let financeController: FinanceController;
  let kafkaBroker: InMemoryKafkaBroker;

  beforeEach(async () => {
    vi.clearAllMocks();
    kafkaBroker = new InMemoryKafkaBroker();
    setKafkaBroker(kafkaBroker);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    financeService = moduleRef.get<FinanceService>(FinanceService);
    financeController = moduleRef.get<FinanceController>(FinanceController);
    financeService.clear();

    // Seed customer account
    await financeService.createCustomerAccount({
      id: "cust-magacity",
      customerName: "Maga Engineering (Pvt) Ltd",
      creditLimitCents: 1000000000, // 10,000,000.00 LKR credit limit
    });
  });

  // --------------------------------------------------------------------------
  // 1. Dependency Injection Resolution
  // --------------------------------------------------------------------------
  describe("1. NestJS DI Container Resolution", () => {
    it("successfully resolves FinanceService and FinanceController from AppModule", () => {
      expect(financeService).toBeDefined();
      expect(financeController).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Customer Credit Limits & Credit Hold Guards
  // --------------------------------------------------------------------------
  describe("2. Customer Credit Limits & Hold Enforcement", () => {
    it("approves transactions within credit limit and rejects requests exceeding limit", async () => {
      // 1. Request within limit (3,000,000 LKR = 300,000,000 cents) -> APPROVED
      const check1 = await financeService.checkCreditApproval("cust-magacity", 300000000);
      expect(check1.approved).toBe(true);
      expect(check1.availableCreditCents).toBe(1000000000);

      // 2. Post an AR invoice of 8,000,000 LKR (800,000,000 cents)
      await financeService.postARInvoice({
        invoiceNumber: "INV-2026-001",
        customerId: "cust-magacity",
        totalAmountCents: 800000000,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // 3. New request for 3,000,000 LKR exceeds remaining 2,000,000 LKR available -> REJECTED
      const check2 = await financeService.checkCreditApproval("cust-magacity", 300000000);
      expect(check2.approved).toBe(false);
      expect(check2.availableCreditCents).toBe(200000000);
      expect(check2.reason).toContain("exceeds available credit limit");
    });

    it("enforces administrative credit hold blocking all new transactions", async () => {
      // Apply credit hold by ADMIN
      const updated = await financeService.setCreditHold(
        {
          customerId: "cust-magacity",
          creditHold: true,
          reason: "Overdue 90-day invoices pending director resolution",
        },
        "finance-director",
        "ADMIN"
      );

      expect(updated.creditHold).toBe(true);
      expect(updated.creditHoldReason).toContain("Overdue 90-day invoices");

      // Verify transaction blocked regardless of amount
      const check = await financeService.checkCreditApproval("cust-magacity", 10000);
      expect(check.approved).toBe(false);
      expect(check.creditHold).toBe(true);
      expect(check.reason).toContain("Customer is on credit hold");

      // Verify Kafka event published
      const published = kafkaBroker.getPublishedMessages();
      expect(published).toHaveLength(1);
      const event = JSON.parse(published[0].value);
      expect(event.eventType).toBe("CreditHoldStatusChanged");
      expect(event.creditHold).toBe(true);
    });

    it("rejects credit hold modification by non-admin roles", async () => {
      await expect(
        financeService.setCreditHold(
          { customerId: "cust-magacity", creditHold: true },
          "cashier-1",
          "DISPENSER"
        )
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-Invoice Lump-Sum FIFO Payment Allocation
  // --------------------------------------------------------------------------
  describe("3. Multi-Invoice Lump-Sum FIFO Payment Allocation", () => {
    it("allocates a corporate lump-sum payment across oldest invoices first (FIFO)", async () => {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;

      // 1. Post 3 invoices with different due dates
      const inv1 = await financeService.postARInvoice({
        invoiceNumber: "INV-OLD-1",
        customerId: "cust-magacity",
        totalAmountCents: 200000000, // 2,000,000 LKR (Due 60 days ago)
        dueDate: new Date(now - 60 * day),
      });

      const inv2 = await financeService.postARInvoice({
        invoiceNumber: "INV-MID-2",
        customerId: "cust-magacity",
        totalAmountCents: 300000000, // 3,000,000 LKR (Due 30 days ago)
        dueDate: new Date(now - 30 * day),
      });

      const inv3 = await financeService.postARInvoice({
        invoiceNumber: "INV-NEW-3",
        customerId: "cust-magacity",
        totalAmountCents: 400000000, // 4,000,000 LKR (Due today)
        dueDate: new Date(now),
      });

      // Total balance = 9,000,000 LKR
      const accountBefore = await financeService.getCustomerAccount("cust-magacity");
      expect(accountBefore?.outstandingBalanceCents).toBe(900000000);

      // 2. Customer pays a lump sum of 4,500,000 LKR (450,000,000 cents) by bank wire
      const payment = await financeService.allocatePayment(
        {
          customerId: "cust-magacity",
          paymentAmountCents: 450000000,
          paymentMethod: "BANK_TRANSFER",
          referenceNumber: "BOC-WIRE-992144",
          notes: "Lump sum settlement for Q2 invoices",
        },
        "treasury-officer-1"
      );

      expect(payment.paymentNumber).toMatch(/^PMT-2026-\d+$/);
      expect(payment.allocations).toHaveLength(2); // Invoices 1 and 2

      // Verify Inv 1 fully paid
      expect(payment.allocations[0].invoiceNumber).toBe("INV-OLD-1");
      expect(payment.allocations[0].amountCents).toBe(200000000);
      expect(payment.allocations[0].newBalanceCents).toBe(0);
      expect(inv1.status).toBe("PAID");

      // Verify Inv 2 partially paid with remaining 2,500,000 LKR
      expect(payment.allocations[1].invoiceNumber).toBe("INV-MID-2");
      expect(payment.allocations[1].amountCents).toBe(250000000);
      expect(payment.allocations[1].newBalanceCents).toBe(50000000); // 500,000 LKR remaining
      expect(inv2.status).toBe("PARTIALLY_PAID");

      // Verify Inv 3 completely unpaid
      expect(inv3.status).toBe("UNPAID");
      expect(inv3.balanceDueCents).toBe(400000000);

      // Verify Customer balance reduced from 9M to 4.5M LKR
      const accountAfter = await financeService.getCustomerAccount("cust-magacity");
      expect(accountAfter?.outstandingBalanceCents).toBe(450000000);
      expect(accountAfter?.unallocatedCreditCents).toBe(0);

      // Verify Kafka event published
      const published = kafkaBroker.getPublishedMessages("billing.payment.received");
      expect(published).toHaveLength(1);
    });

    it("holds overpayment as unallocated credit balance when payment exceeds total debt", async () => {
      // Invoice: 1,000,000 LKR (100,000,000 cents)
      await financeService.postARInvoice({
        invoiceNumber: "INV-SINGLE-1",
        customerId: "cust-magacity",
        totalAmountCents: 100000000,
        dueDate: new Date(),
      });

      // Customer pays 1,500,000 LKR (150,000,000 cents)
      const payment = await financeService.allocatePayment(
        {
          customerId: "cust-magacity",
          paymentAmountCents: 150000000,
          paymentMethod: "CHEQUE",
          referenceNumber: "CHQ-778811",
        },
        "cashier-1"
      );

      expect(payment.allocations).toHaveLength(1);
      expect(payment.unallocatedAmountCents).toBe(50000000); // 500,000 LKR credit

      const customer = await financeService.getCustomerAccount("cust-magacity");
      expect(customer?.outstandingBalanceCents).toBe(0);
      expect(customer?.unallocatedCreditCents).toBe(50000000);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Financial Aging Schedule Reports
  // --------------------------------------------------------------------------
  describe("4. Financial Aging Schedule (0-30, 31-60, 61-90, 90+ days)", () => {
    it("categorizes open invoices into correct aging schedule buckets", async () => {
      const asOfDate = new Date("2026-10-09T00:00:00Z");
      const day = 24 * 60 * 60 * 1000;

      // 1. Current / 0-30 days (due 15 days ago) -> 1,000,000 LKR
      await financeService.postARInvoice({
        invoiceNumber: "INV-BUCKET-1",
        customerId: "cust-magacity",
        totalAmountCents: 100000000,
        dueDate: new Date(asOfDate.getTime() - 15 * day),
      });

      // 2. 31-60 days (due 45 days ago) -> 2,000,000 LKR
      await financeService.postARInvoice({
        invoiceNumber: "INV-BUCKET-2",
        customerId: "cust-magacity",
        totalAmountCents: 200000000,
        dueDate: new Date(asOfDate.getTime() - 45 * day),
      });

      // 3. 61-90 days (due 75 days ago) -> 3,000,000 LKR
      await financeService.postARInvoice({
        invoiceNumber: "INV-BUCKET-3",
        customerId: "cust-magacity",
        totalAmountCents: 300000000,
        dueDate: new Date(asOfDate.getTime() - 75 * day),
      });

      // 4. 90+ days (due 120 days ago) -> 4,000,000 LKR
      await financeService.postARInvoice({
        invoiceNumber: "INV-BUCKET-4",
        customerId: "cust-magacity",
        totalAmountCents: 400000000,
        dueDate: new Date(asOfDate.getTime() - 120 * day),
      });

      const report = await financeService.generateAgingReport(asOfDate);

      expect(report).toHaveLength(1);
      const custReport = report[0];
      expect(custReport.customerId).toBe("cust-magacity");
      expect(custReport.current0to30Cents).toBe(100000000);
      expect(custReport.days31to60Cents).toBe(200000000);
      expect(custReport.days61to90Cents).toBe(300000000);
      expect(custReport.over90DaysCents).toBe(400000000);
      expect(custReport.totalOutstandingCents).toBe(1000000000); // 10,000,000 LKR total
    });
  });
});
