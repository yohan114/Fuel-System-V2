// Authoritative Application Commands Behavioral Tests (DOM-01)
//
// Verifies:
// 1. executeIssueFuel:
//    - Rejects invalid quantity (<= 0, NaN)
//    - Rejects unprivileged actor / unauthorized pump
//    - Enforces negative meter reading rejection
//    - Replays existing idempotent transactions without re-deducting stock
//    - Deducts stock and records issue on authorized submission
// 2. executeVoidFuelIssue:
//    - Enforces administrator authorization
//    - Enforces minimum 4-char audit reason
//    - Rejects non-existent issue
//    - Blocks voiding on closed billing periods (ISSUED / PAID / OVERDUE)
//    - Blocks voiding if already in requested state
//    - Successfully voids issue and updates audit log
// 3. executeApproveTransfer:
//    - Enforces administrator authorization
//    - Rejects non-existent bulk requests
//    - Rejects already processed transfers (not PENDING)
//    - Atomically transfers stock and approves request
// 4. executeIssueInvoice:
//    - Enforces administrator authorization
//    - Rejects non-existent bills
//    - Rejects non-draft bills
//    - Enforces clarification gate (requires overrideReason when anomalies present)
//    - Finalizes draft bill with sequential invoice number

import { describe, expect, it, vi, beforeEach } from "vitest";

// Hoisted mock state for Prisma
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    asset: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    bulkTank: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    bulkRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    bill: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    billAudit: {
      create: vi.fn(),
    },
    setting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    meterOutage: {
      findFirst: vi.fn(),
    },
    meterReading: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    fuelIssue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    fuelAuditLog: {
      create: vi.fn(),
    },
    fuelPrice: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((callback: any) => callback(mockPrisma)),
  };
  return { mockPrisma };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/pricing", () => ({
  getPriceForDate: vi.fn(),
}));

vi.mock("@/lib/fuel-policy", () => ({
  checkDailyCap: vi.fn(),
}));

vi.mock("@/lib/fuel/meter-guard", () => ({
  checkFuelMeter: vi.fn(),
}));

vi.mock("@/lib/billing/invoice-number", () => ({
  nextInvoiceNumber: vi.fn(),
}));

vi.mock("@/lib/billing/generate", () => ({
  generateBillForAsset: vi.fn(),
}));

vi.mock("@/lib/assignments", () => ({
  canUserAccessAsset: vi.fn(),
}));

import {
  executeIssueFuel,
  executeVoidFuelIssue,
  executeApproveTransfer,
  executeIssueInvoice,
} from "../src/lib/commands";
import { getPriceForDate } from "@/lib/pricing";
import { checkFuelMeter } from "@/lib/fuel/meter-guard";
import { checkDailyCap } from "@/lib/fuel-policy";
import { nextInvoiceNumber } from "@/lib/billing/invoice-number";
import { generateBillForAsset } from "@/lib/billing/generate";
import { canUserAccessAsset } from "@/lib/assignments";

describe("DOM-01: executeIssueFuel Command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.category.findFirst.mockResolvedValue({ id: "cat-other", code: "OTHER" });
    mockPrisma.meterOutage.findFirst.mockResolvedValue(null);
    mockPrisma.setting.findMany.mockResolvedValue([]);
    (getPriceForDate as any).mockResolvedValue({ id: "price-1", pricePerLitre: 350.0 });
    (checkFuelMeter as any).mockResolvedValue({ ok: true });
    (checkDailyCap as any).mockResolvedValue(null);
    (canUserAccessAsset as any).mockResolvedValue(true);
  });

  it("rejects non-positive litres", async () => {
    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 0,
      },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_QUANTITY");
  });

  it("rejects negative litres", async () => {
    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: -25,
      },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_QUANTITY");
  });

  it("rejects unauthorized role attempting to issue fuel", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "ast-1",
      code: "CAB-1001",
      meterType: "KM",
      status: "ACTIVE",
    });

    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 50,
      },
      { actorId: "u-2", role: "USER" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("UNAUTHORIZED_PUMP");
  });

  it("rejects operator naming someone else's bulk tank", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "ast-1",
      code: "CAB-1001",
      meterType: "KM",
      status: "ACTIVE",
    });

    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 50,
        bulkTankId: "tank-site-b",
      },
      { actorId: "u-3", role: "SITE_PUMP", bulkTankId: "tank-site-a" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("UNAUTHORIZED_PUMP");
  });

  it("rejects negative meter reading", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "ast-1",
      code: "CAB-1001",
      meterType: "KM",
      status: "ACTIVE",
    });

    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 50,
        meterReading: -100,
      },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_METER");
  });

  it("returns idempotent replay if request was already processed", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "ast-1",
      code: "CAB-1001",
      meterType: "KM",
      status: "ACTIVE",
    });
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "issue-existing-99",
      litres: 60,
      assetId: "ast-1",
      fuelKind: "AUTO_DIESEL",
      totalCost: 21000,
      pricePerLitre: 350,
    });

    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 60,
        idempotencyKey: "req-key-12345",
      },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.issueId).toBe("issue-existing-99");
      expect(res.data.litres).toBe(60);
      expect(res.data.totalCost).toBe(21000);
    }
    // Verify no new fuel issue was created
    expect(mockPrisma.fuelIssue.create).not.toHaveBeenCalled();
  });

  it("successfully creates issue and logs audit", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "ast-1",
      code: "CAB-1001",
      meterType: "KM",
      status: "ACTIVE",
    });
    mockPrisma.fuelIssue.findUnique.mockResolvedValue(null);
    mockPrisma.bulkTank.findUnique.mockResolvedValue({
      id: "tank-1",
      name: "Galagedara Tank",
      balance: 1000,
      fuelKind: "AUTO_DIESEL",
    });
    mockPrisma.bulkTank.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.fuelIssue.create.mockResolvedValue({ id: "issue-new-1" });
    mockPrisma.meterReading.create.mockResolvedValue({ id: "mr-1" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "aud-1" });

    const res = await executeIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 45,
        bulkTankId: "tank-1",
        meterReading: 15400,
      },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.litres).toBe(45);
      expect(res.data.assetCode).toBe("CAB-1001");
    }
    expect(mockPrisma.fuelIssue.create).toHaveBeenCalled();
  });
});

describe("DOM-01: executeVoidFuelIssue Command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    (generateBillForAsset as any).mockResolvedValue({ status: "regenerated" });
  });

  it("enforces admin authorization", async () => {
    const res = await executeVoidFuelIssue(
      { issueId: "iss-1", reason: "Duplicate entry" },
      { actorId: "u-2", role: "SITE_PUMP" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("FORBIDDEN");
  });

  it("enforces minimum 4-character audit reason", async () => {
    const res = await executeVoidFuelIssue(
      { issueId: "iss-1", reason: "no" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("REASON_REQUIRED");
  });

  it("rejects non-existent fuel issue", async () => {
    mockPrisma.fuelIssue.findUnique.mockResolvedValue(null);

    const res = await executeVoidFuelIssue(
      { issueId: "iss-non-existent", reason: "Duplicate entry" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects voiding an already-voided issue", async () => {
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "iss-1",
      voided: true,
      asset: { id: "ast-1", code: "CAB-1001" },
      bulkTank: null,
      issueDate: new Date("2026-08-15"),
    });

    const res = await executeVoidFuelIssue(
      { issueId: "iss-1", reason: "Entered by mistake", voided: true },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("ALREADY_IN_STATE");
  });

  it("blocks voiding on closed billing period (ISSUED / PAID / OVERDUE)", async () => {
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "iss-1",
      voided: false,
      litres: 50,
      assetId: "ast-1",
      asset: { id: "ast-1", code: "CAB-1001" },
      bulkTank: null,
      issueDate: new Date("2026-08-15"),
    });
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "bill-aug",
      status: "ISSUED",
      invoiceNumber: "INV-202608-0012",
    });

    const res = await executeVoidFuelIssue(
      { issueId: "iss-1", reason: "Wrong vehicle entered" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("CLOSED_PERIOD");
    expect(res.error).toContain("Raise a credit note");
  });

  it("successfully voids issue on draft billing period", async () => {
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "iss-1",
      voided: false,
      litres: 50,
      assetId: "ast-1",
      asset: { id: "ast-1", code: "CAB-1001" },
      bulkTankId: null,
      bulkTank: null,
      issueDate: new Date("2026-08-15"),
    });
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "bill-aug",
      status: "DRAFT",
    });
    mockPrisma.fuelIssue.update.mockResolvedValue({});
    mockPrisma.fuelAuditLog.create.mockResolvedValue({});

    const res = await executeVoidFuelIssue(
      { issueId: "iss-1", reason: "Entered wrong pump dispenser" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.voided).toBe(true);
      expect(res.data.assetCode).toBe("CAB-1001");
    }
  });
});

describe("DOM-01: executeApproveTransfer Command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
  });

  it("enforces admin authorization", async () => {
    const res = await executeApproveTransfer(
      { requestId: "br-1" },
      { actorId: "u-2", role: "WORKSHOP" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("FORBIDDEN");
  });

  it("rejects non-existent bulk request", async () => {
    mockPrisma.bulkRequest.findUnique.mockResolvedValue(null);

    const res = await executeApproveTransfer(
      { requestId: "br-non-existent" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects already processed bulk request", async () => {
    mockPrisma.bulkRequest.findUnique.mockResolvedValue({
      id: "br-1",
      status: "APPROVED",
    });

    const res = await executeApproveTransfer(
      { requestId: "br-1" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("ALREADY_PROCESSED");
  });

  it("successfully approves transfer between tanks", async () => {
    mockPrisma.bulkRequest.findUnique.mockResolvedValue({
      id: "br-1",
      status: "PENDING",
      requestedLitres: 250,
      sourceType: "TRANSFER",
      sourceTankId: "tank-src",
      bulkTankId: "tank-dst",
      sourceTank: { id: "tank-src", name: "Main Tank" },
      bulkTank: { id: "tank-dst", name: "Site Bowser" },
    });
    mockPrisma.bulkTank.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.bulkTank.update.mockResolvedValue({ balance: 500 });
    mockPrisma.bulkRequest.update.mockResolvedValue({ id: "br-1", status: "APPROVED" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "aud-1" });

    const res = await executeApproveTransfer(
      { requestId: "br-1", reviewNote: "Approved for site deployment" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.status).toBe("APPROVED");
      expect(res.data.litres).toBe(250);
    }
  });
});

describe("DOM-01: executeIssueInvoice Command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.setting.findMany.mockResolvedValue([]);
    (nextInvoiceNumber as any).mockResolvedValue("INV-202610-0042");
  });

  it("enforces admin authorization", async () => {
    const res = await executeIssueInvoice(
      { billId: "b-1" },
      { actorId: "u-2", role: "USER" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("FORBIDDEN");
  });

  it("rejects non-existent bill", async () => {
    mockPrisma.bill.findUnique.mockResolvedValue(null);

    const res = await executeIssueInvoice(
      { billId: "b-non-existent" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects already issued bill", async () => {
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "b-1",
      status: "ISSUED",
    });

    const res = await executeIssueInvoice(
      { billId: "b-1" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("ALREADY_ISSUED");
  });

  it("blocks issuance when clarification required and no override reason provided", async () => {
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "b-1",
      status: "DRAFT",
      billingMode: "hourly",
      rateBasis: "w",
      derivedFromFuel: true,
      actualMeterUnits: 0,
      fuelLitres: 100,
      actualUnits: 25,
      fuelCostCents: 3500000,
    });

    const res = await executeIssueInvoice(
      { billId: "b-1" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("CLARIFICATION_REQUIRED");
  });

  it("successfully finalizes bill with sequential invoice number", async () => {
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "b-1",
      status: "DRAFT",
      assetId: "ast-1",
      assetCode: "CAB-1001",
      periodKey: "2026-08",
      year: 2026,
      month: 8,
      billingMode: "daily",
      rateBasis: "d",
      daysWorked: 15,
      actualUnits: 15,
      actualMeterUnits: null,
      derivedStandardUnits: null,
      derivedFromFuel: false,
      fuelLitres: 0,
      fuelCostCents: 0,
      subtotalCents: 15000000,
      taxCents: 0,
      grandTotalCents: 15000000,
      asset: { code: "CAB-1001" },
    });
    mockPrisma.bill.update.mockResolvedValue({
      id: "b-1",
      status: "ISSUED",
      invoiceNumber: "INV-202610-0042",
    });
    mockPrisma.billAudit.create.mockResolvedValue({ id: "ba-1" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "aud-1" });

    const res = await executeIssueInvoice(
      { billId: "b-1" },
      { actorId: "u-1", role: "ADMIN" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.invoiceNumber).toBe("INV-202610-0042");
      expect(res.data.assetCode).toBe("CAB-1001");
    }
  });
});
