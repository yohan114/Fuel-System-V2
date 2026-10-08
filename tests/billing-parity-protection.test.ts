// ============================================================================
// BILL-01: Billing Parity, Golden Cases, and Invoice Protection Test Suite
// Verifies:
// 1. Immutable issued invoice protection (zero regeneration/overwrites)
// 2. Sri Lankan statutory tax calculation parity (SSCL 2.5%, VAT 18%)
// 3. Multi-archetype golden case mathematical equivalence
// 4. Revision snapshot parsing, integrity, and diff detection
// 5. IssueInvoice authorization and clarification controls
// ============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { computeTotals } from "../src/lib/billing/calc";
import {
  buildBillSnapshot,
  parseBillSnapshot,
  summarizeRevisionDiff,
  type SnapshotSourceBill,
} from "../src/lib/billing/revisions";
import { executeIssueInvoice } from "../src/lib/commands/issue-invoice";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";

// Hoisted mock state for Prisma database calls in command & generator tests
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma: any = {
    bill: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    billLineItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    billRevision: {
      count: vi.fn(),
      create: vi.fn(),
    },
    asset: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    invoiceCounter: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { mockPrisma };
});

vi.mock("../src/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

describe("BILL-01: Billing Parity & Statutory Tax Precision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Sri Lankan Statutory Tax Math (SSCL 2.5% + VAT 18%)", () => {
    it("computes exact taxes for dry hire without fuel charges", () => {
      const calc = computeTotals({
        billingMode: "perday",
        rateBasis: "d",
        rateCents: 11_000_00, // Rs. 11,000 / day
        actualUnits: 0,
        minimumUnits: 26,
        fuelLitres: 90,
        fuelCostCents: 30_000_00,
        ssclRate: 0.025,
        vatRate: 0.18,
      });

      // Rental = 26 * 11,000 = Rs. 286,000
      expect(calc.rentalAmountCents).toBe(286_000_00);
      expect(calc.fuelChargedCents).toBe(0); // Dry hire ignores fuel
      expect(calc.subtotalCents).toBe(286_000_00);

      // SSCL = 286,000 * 0.025 = Rs. 7,150
      expect(calc.ssclCents).toBe(7_150_00);

      // VAT = (286,000 + 7,150) * 0.18 = 293,150 * 0.18 = Rs. 52,767
      expect(calc.vatCents).toBe(52_767_00);

      // Grand Total = 286,000 + 7,150 + 52,767 = Rs. 345,917
      expect(calc.grandTotalCents).toBe(345_917_00);
    });

    it("computes exact taxes for wet hire including fuel recharges", () => {
      const calc = computeTotals({
        billingMode: "hourly",
        rateBasis: "w",
        rateCents: 5_100_00, // Rs. 5,100 / hr
        actualUnits: 24.545454545454543,
        minimumUnits: 120, // Guarantee floor
        fuelLitres: 270,
        fuelCostCents: 105_490_00, // Rs. 105,490
        ssclRate: 0.025,
        vatRate: 0.18,
      });

      expect(calc.billableUnits).toBe(120);
      expect(calc.rentalAmountCents).toBe(612_000_00); // 120 * 5,100
      expect(calc.fuelChargedCents).toBe(105_490_00); // Wet charges fuel
      expect(calc.subtotalCents).toBe(717_490_00); // 612,000 + 105,490

      // SSCL = round(717,490 * 0.025) = 17,937.25 -> 1793725 cents
      expect(calc.ssclCents).toBe(17_937_25);

      // VAT = round((717,490 + 17,937.25) * 0.18) = round(735,427.25 * 0.18) = 13237691 cents
      expect(calc.vatCents).toBe(132_376_91);

      // Grand Total = 717,490 + 17,937.25 + 132,376.91 = 86780416 cents
      expect(calc.grandTotalCents).toBe(867_804_16);
    });

    it("computes exact taxes for fuel-only vehicles with zero rental", () => {
      const calc = computeTotals({
        billingMode: "hourly",
        rateBasis: "w",
        rateCents: 0,
        actualUnits: 0,
        minimumUnits: 120,
        fuelLitres: 5368,
        fuelCostCents: 1_535_248_00,
        ssclRate: 0.025,
        vatRate: 0.18,
        fuelOnly: true,
      });

      expect(calc.rentalAmountCents).toBe(0);
      expect(calc.fuelChargedCents).toBe(1_535_248_00);
      expect(calc.subtotalCents).toBe(1_535_248_00);

      // SSCL = 1,535,248 * 0.025 = 38,381.20
      expect(calc.ssclCents).toBe(38_381_20);

      // VAT = (1,535,248 + 38,381.20) * 0.18 = 1,573,629.20 * 0.18 = 283,253.26
      expect(calc.vatCents).toBe(283_253_26);

      // Grand Total = 1,535,248 + 38,381.20 + 283,253.26 = 1,856,882.46
      expect(calc.grandTotalCents).toBe(1_856_882_46);
    });

    it("enforces integer cent rounding on fractional working days (AC-24 golden case)", () => {
      const billableUnits = 16.774193548387096;
      const rateCents = 11_000_00;
      const rentalAmountCents = Math.round(billableUnits * rateCents); // 18451613 cents
      expect(rentalAmountCents).toBe(18_451_613);

      const calc = computeTotals({
        billingMode: "perday",
        rateBasis: "d",
        rateCents,
        actualUnits: billableUnits,
        minimumUnits: 0,
        fuelLitres: 50,
        fuelCostCents: 0,
        ssclRate: 0.025,
        vatRate: 0.18,
      });

      expect(calc.subtotalCents).toBe(18_451_613);
      expect(calc.ssclCents).toBe(461_290); // round(18451613 * 0.025)
      expect(calc.vatCents).toBe(3_404_323); // round((18451613 + 461290) * 0.18)
      expect(calc.grandTotalCents).toBe(22_317_226); // 18451613 + 461290 + 3404323
    });
  });

  describe("Historical Issued Invoice Protection (Dataset Rehearsal Verification)", () => {
    it("preserves all 4 historical issued invoices with exact bit-for-bit math parity", () => {
      const billsPath = path.resolve(process.cwd(), "data", "rehearsal", "Bill.json");
      const bills = JSON.parse(fs.readFileSync(billsPath, "utf-8"));
      const issued = bills.filter((b: any) => b.status === "ISSUED");

      expect(issued.length).toBe(4);

      const expected = [
        {
          inv: "EC-INV-2026-0001",
          asset: "AC-25",
          subtotal: 286_000_00,
          sscl: 7_150_00,
          vat: 52_767_00,
          grand: 345_917_00,
        },
        {
          inv: "EC-INV-2026-0002",
          asset: "WATER PUMP",
          subtotal: 98_800_00,
          sscl: 2_470_00,
          vat: 18_228_60,
          grand: 119_498_60,
        },
        {
          inv: "EC-INV-2026-0003",
          asset: "GE-62",
          subtotal: 260_000_00,
          sscl: 6_500_00,
          vat: 47_970_00,
          grand: 314_470_00,
        },
        {
          inv: "EC-INV-2026-0004",
          asset: "AC-24",
          subtotal: 18_451_613,
          sscl: 461_290,
          vat: 3_404_323,
          grand: 22_317_226,
        },
      ];

      for (const exp of expected) {
        const inv = issued.find((b: any) => b.invoiceNumber === exp.inv);
        expect(inv).toBeDefined();
        expect(inv.assetCode).toBe(exp.asset);
        expect(inv.subtotalCents).toBe(exp.subtotal);
        expect(inv.ssclCents).toBe(exp.sscl);
        expect(inv.vatCents).toBe(exp.vat);
        expect(inv.grandTotalCents).toBe(exp.grand);

        // Re-verify against pure statutory tax calculation
        const expectedSscl = Math.round(inv.subtotalCents * 0.025);
        const expectedVat = Math.round((inv.subtotalCents + expectedSscl) * 0.18);
        expect(inv.ssclCents).toBe(expectedSscl);
        expect(inv.vatCents).toBe(expectedVat);
        expect(inv.grandTotalCents).toBe(inv.subtotalCents + expectedSscl + expectedVat);
      }
    });

    it("guards generateBillForAsset from mutating or regenerating an ISSUED bill", async () => {
      const mockIssuedBill = {
        id: "bill-issued-1",
        assetId: "asset-1",
        status: "ISSUED",
        invoiceNumber: "EC-INV-2026-0001",
        year: 2026,
        month: 7,
        grandTotalCents: 345_917_00,
      };

      mockPrisma.asset.findUnique.mockResolvedValue({
        id: "asset-1",
        code: "AC-25",
        rentalRate: { id: "rate-1" },
        billedDirect: false,
        billFuelOnly: false,
      });

      mockPrisma.bill.findUnique.mockResolvedValue(mockIssuedBill);

      const res = await generateBillForAsset(
        "asset-1",
        resolvePeriod(2026, 7),
        { regenerate: true }
      );

      // Must return skipped-finalized without side effects
      expect(res.status).toBe("skipped-finalized");
      expect(res.billId).toBe("bill-issued-1");

      // Verify no deletion or mutation occurred
      expect(mockPrisma.billLineItem.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.bill.delete).not.toHaveBeenCalled();
      expect(mockPrisma.bill.update).not.toHaveBeenCalled();
    });
  });

  describe("Invoice Snapshots & Diff Tracking", () => {
    const mockBill: SnapshotSourceBill = {
      billingMode: "hourly",
      rateCents: 5_000_00,
      actualUnits: 100,
      minimumUnits: 120,
      billableUnits: 120,
      rentalAmountCents: 600_000_00,
      fuelLitres: 200,
      fuelCostCents: 75_000_00,
      subtotalCents: 675_000_00,
      ssclCents: 16_875_00,
      vatCents: 124_537_50,
      grandTotalCents: 816_412_50,
    };

    it("serializes and parses bill snapshots accurately", () => {
      const snap = buildBillSnapshot(mockBill, [
        {
          kind: "RENTAL",
          description: "Machine Rental - 120 hrs",
          quantity: 120,
          unit: "hr",
          unitRateCents: 5_000_00,
          amountCents: 600_000_00,
        },
        {
          kind: "FUEL",
          description: "Diesel Fuel - 200 L",
          quantity: 200,
          unit: "L",
          unitRateCents: 375_00,
          amountCents: 75_000_00,
        },
      ]);

      const json = JSON.stringify(snap);
      const parsed = parseBillSnapshot(json);

      expect(parsed).not.toBeNull();
      expect(parsed?.subtotalCents).toBe(mockBill.subtotalCents);
      expect(parsed?.grandTotalCents).toBe(mockBill.grandTotalCents);
      expect(parsed?.lineItems.length).toBe(2);
      expect(parsed?.lineItems[0].kind).toBe("RENTAL");
      expect(parsed?.lineItems[1].kind).toBe("FUEL");
    });

    it("gracefully returns null for corrupt snapshot JSON", () => {
      expect(parseBillSnapshot("")).toBeNull();
      expect(parseBillSnapshot("{ invalid json")).toBeNull();
      expect(parseBillSnapshot("{\"missing\": \"grandTotal\"}")).toBeNull();
    });

    it("summarizes financial diffs between revisions cleanly", () => {
      const snap1 = buildBillSnapshot(mockBill, []);
      const snap2 = buildBillSnapshot(
        {
          ...mockBill,
          actualUnits: 150,
          billableUnits: 150,
          rentalAmountCents: 750_000_00,
          subtotalCents: 825_000_00,
          grandTotalCents: 997_837_50,
        },
        []
      );

      const diffs = summarizeRevisionDiff(snap1, snap2);
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs.some((d) => d.includes("Grand total"))).toBe(true);
      expect(diffs.some((d) => d.includes("Subtotal"))).toBe(true);
      expect(diffs.some((d) => d.includes("Rental"))).toBe(true);
      expect(diffs.some((d) => d.includes("Billable units"))).toBe(true);
    });
  });

  describe("executeIssueInvoice Command Security & Business Rules", () => {
    it("rejects non-admin role when issuing an invoice", async () => {
      const res = await executeIssueInvoice(
        { billId: "bill-1" },
        { actorId: "user-123", role: "SITE_OFFICER" as any, ipAddress: "127.0.0.1" }
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("FORBIDDEN");
    });

    it("returns NOT_FOUND for non-existent bill ID", async () => {
      mockPrisma.bill.findUnique.mockResolvedValue(null);

      const res = await executeIssueInvoice(
        { billId: "non-existent" },
        { actorId: "admin-1", role: "ADMIN", ipAddress: "127.0.0.1" }
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("NOT_FOUND");
    });

    it("rejects issuing an invoice that is already in ISSUED status", async () => {
      mockPrisma.bill.findUnique.mockResolvedValue({
        id: "bill-issued-1",
        status: "ISSUED",
        invoiceNumber: "EC-INV-2026-0001",
      });

      const res = await executeIssueInvoice(
        { billId: "bill-issued-1" },
        { actorId: "admin-1", role: "ADMIN", ipAddress: "127.0.0.1" }
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("ALREADY_ISSUED");
    });

    it("blocks issuing when clarification reasons exist without override note", async () => {
      mockPrisma.bill.findUnique.mockResolvedValue({
        id: "bill-draft-1",
        status: "DRAFT",
        billingMode: "hourly",
        rateBasis: "w",
        actualUnits: 50,
        actualMeterUnits: 0,
        derivedStandardUnits: null,
        derivedFromFuel: false,
        fuelLitres: 100,
        fuelCostCents: 0, // Triggers "Fuel was issued (100 L) but priced at Rs 0"
        rentalAmountCents: 100000,
        notes: null,
      });

      const res = await executeIssueInvoice(
        { billId: "bill-draft-1" },
        { actorId: "admin-1", role: "ADMIN", ipAddress: "127.0.0.1" }
      );

      // Clarification gate triggered
      expect(res.success).toBe(false);
      expect(res.code).toBe("CLARIFICATION_REQUIRED");
      expect(res.blocked).toBe(true);
    });

    it("successfully issues invoice with sequential invoice number in transaction", async () => {
      const mockDraft = {
        id: "bill-draft-ok",
        status: "DRAFT",
        year: 2026,
        month: 7,
        periodKey: "2026-07",
        assetCode: "AC-25",
        billingMode: "perday",
        rateBasis: "d",
        actualUnits: 26,
        actualMeterUnits: null,
        derivedStandardUnits: null,
        derivedFromFuel: false,
        minimumUnits: 26,
        fuelLitres: 90,
        fuelCostCents: 0,
        rentalAmountCents: 286_000_00,
        grandTotalCents: 345_917_00,
        notes: null,
      };

      mockPrisma.bill.findUnique.mockResolvedValue(mockDraft);
      mockPrisma.setting.findUnique.mockResolvedValue(null);

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          bill: {
            findUnique: vi.fn().mockResolvedValue(mockDraft),
            update: vi.fn().mockResolvedValue({
              ...mockDraft,
              status: "ISSUED",
              invoiceNumber: "EC-INV-2026-0042",
            }),
          },
          invoiceCounter: {
            findUnique: vi.fn().mockResolvedValue({ year: 2026, lastSeq: 41 }),
            update: vi.fn().mockResolvedValue({ year: 2026, lastSeq: 42 }),
            upsert: vi.fn(),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: "audit-1" }),
          },
        };
        return callback(tx);
      });

      const res = await executeIssueInvoice(
        { billId: "bill-draft-ok" },
        { actorId: "admin-1", role: "ADMIN", ipAddress: "127.0.0.1" }
      );

      expect(res.success).toBe(true);
      expect(res.data?.invoiceNumber).toBe("EC-INV-2026-0042");
    });
  });
});
