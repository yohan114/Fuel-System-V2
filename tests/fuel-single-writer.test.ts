// Fuel Single-Writer Authority & Outbox Gateway Test Suite (Task API-02 / Wave D)
//
// Verifies:
// 1. Authoritative write gateway routing (LOCAL_COMMAND vs REMOTE_API).
// 2. Atomic stock decrement and non-negative balance enforcement under single writer.
// 3. Replay-safe idempotency handling (identical key returns cached issue without duplicate side-effects).
// 4. Transactional outbox event emission (FuelIssued and FuelVoided events captured).
// 5. Remote API delegation with X-Idempotency-Key headers and RFC 7807 Problem Details translation.
// 6. Void fuel issue workflow under single-writer delegation.
// 7. ADR 0004 architectural documentation compliance.

import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  getFuelWriteAuthority,
  setFuelWriteAuthorityForTesting,
  dispatchIssueFuel,
  dispatchVoidFuelIssue,
} from "../src/lib/fuel/write-gateway";
import { testOutboxBuffer, clearTestOutboxBuffer } from "../src/lib/fuel/outbox";
import { prisma } from "../src/lib/db";

// Mock prisma for isolated single-writer domain testing
vi.mock("../src/lib/db", () => {
  const mockPrisma: any = {
    asset: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    bulkTank: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({ balance: 955.0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bill: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    fuelPrice: {
      findFirst: vi.fn(),
    },
    fuelIssue: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    meterReading: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    meterOutage: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    setting: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    outboxMessage: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

const mockPrisma = prisma as any;

describe("API-02: Authoritative Fuel Single-Writer Gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTestOutboxBuffer();
    setFuelWriteAuthorityForTesting(null); // Reset to default

    // Setup standard mocks
    mockPrisma.asset.findFirst.mockResolvedValue({
      id: "a-101",
      code: "CAB-1001",
      meterType: "KM",
      fuelKind: "AUTO_DIESEL",
    });

    mockPrisma.bulkTank.findUnique.mockResolvedValue({
      id: "tank-101",
      name: "Main Diesel Tank",
      balance: 1000.0,
      fuelKind: "AUTO_DIESEL",
    });

    mockPrisma.fuelPrice.findFirst.mockResolvedValue({
      id: "fp-101",
      pricePerLitre: 382.0,
    });

    mockPrisma.meterOutage.findFirst.mockResolvedValue(null);
    mockPrisma.fuelIssue.count.mockResolvedValue(0);
    mockPrisma.fuelIssue.findFirst.mockResolvedValue(null);
  });

  it("verifies default write authority mode is LOCAL_COMMAND", () => {
    expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");
  });

  it("allows switching write authority dynamically", () => {
    setFuelWriteAuthorityForTesting("REMOTE_API");
    expect(getFuelWriteAuthority()).toBe("REMOTE_API");

    setFuelWriteAuthorityForTesting("LOCAL_COMMAND");
    expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");
  });

  it("executes IssueFuel through LOCAL_COMMAND and emits FuelIssued outbox event", async () => {
    mockPrisma.fuelIssue.create.mockResolvedValue({
      id: "issue-abc-1",
      litres: 45.0,
      fuelKind: "AUTO_DIESEL",
      totalCost: 17190,
      pricePerLitre: 382.0,
    });

    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 45.0,
        bulkTankId: "tank-101",
        idempotencyKey: "test-idem-key-101",
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(true);
    expect(res.data?.issueId).toBe("issue-abc-1");
    expect(res.data?.litres).toBe(45.0);

    // Verify atomic tank balance decrement was called
    expect(mockPrisma.bulkTank.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "tank-101", balance: { gte: 45.0 } }),
        data: { balance: { decrement: 45.0 } },
      })
    );

    // Verify transactional outbox event was captured
    expect(testOutboxBuffer.length).toBe(1);
    const event = testOutboxBuffer[0];
    expect(event.eventType).toBe("FuelIssued");
    expect(event.aggregateType).toBe("FuelIssue");
    expect(event.aggregateId).toBe("issue-abc-1");
    expect(event.payload.assetCode).toBe("CAB-1001");
    expect(event.payload.litres).toBe(45.0);
    expect(event.payload.totalCost).toBe(17190);
  });

  it("enforces replay-safe idempotency without duplicating stock deduction or outbox events", async () => {
    // Existing issue already found for this key
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "issue-cached-99",
      litres: 45.0,
      assetId: "a-101",
      fuelKind: "AUTO_DIESEL",
      totalCost: 17190,
      pricePerLitre: 382.0,
      importKey: "idem-replay-key-1",
    });

    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 45.0,
        bulkTankId: "tank-101",
        idempotencyKey: "idem-replay-key-1",
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(true);
    expect(res.data?.issueId).toBe("issue-cached-99");

    // Tank deduction and outbox emission must NOT happen again on replay
    expect(mockPrisma.bulkTank.update).not.toHaveBeenCalled();
    expect(testOutboxBuffer.length).toBe(0);
  });

  it("rejects non-positive volume with INVALID_QUANTITY", async () => {
    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 0,
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_QUANTITY");
    expect(mockPrisma.bulkTank.update).not.toHaveBeenCalled();
  });

  it("rejects insufficient stock with INSUFFICIENT_STOCK", async () => {
    mockPrisma.bulkTank.findUnique.mockResolvedValue({
      id: "tank-101",
      name: "Main Diesel Tank",
      balance: 20.0, // Only 20L available!
      fuelKind: "AUTO_DIESEL",
    });

    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 50.0, // Requesting 50L
        bulkTankId: "tank-101",
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INSUFFICIENT_STOCK");
    expect(mockPrisma.bulkTank.update).not.toHaveBeenCalled();
  });

  it("executes VoidFuelIssue through single writer and emits FuelVoided outbox event", async () => {
    mockPrisma.fuelIssue.findUnique.mockResolvedValue({
      id: "issue-to-void-1",
      assetId: "a-101",
      litres: 40.0,
      voided: false,
      bulkTankId: "tank-101",
      issueDate: new Date("2026-08-15T10:00:00Z"),
      asset: { code: "CAB-1001" },
      bulkTank: { name: "Main Diesel Tank", balance: 500.0 },
    });

    const res = await dispatchVoidFuelIssue(
      {
        issueId: "issue-to-void-1",
        reason: "Cancelled field operation",
        voided: true,
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(true);
    expect(res.data?.voided).toBe(true);

    // Verify stock restoration
    expect(mockPrisma.bulkTank.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tank-101" },
        data: { balance: { increment: 40.0 } },
      })
    );

    // Verify FuelVoided outbox event
    expect(testOutboxBuffer.length).toBe(1);
    const event = testOutboxBuffer[0];
    expect(event.eventType).toBe("FuelVoided");
    expect(event.aggregateId).toBe("issue-to-void-1");
    expect(event.payload.litres).toBe(40.0);
    expect(event.payload.reason).toBe("Cancelled field operation");
  });
});

describe("API-02: Remote API Delegation & RFC 7807 Error Handling", () => {
  beforeEach(() => {
    setFuelWriteAuthorityForTesting("REMOTE_API");
  });

  it("proxies request to remote API and handles successful 201 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        issueId: "remote-issue-uuid-1",
        assetCode: "CAB-1001",
        litres: 45.0,
        totalCost: 17190,
        unitPrice: 382.0,
        bulkTankName: "Main Diesel Tank",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 45.0,
        bulkTankId: "tank-101",
        idempotencyKey: "idem-remote-key-1",
      },
      {
        actorId: "u-attendant-1",
        role: "SITE_PUMP",
        projectId: "proj-1",
      }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain("/api/v1/fuel/issues");
    expect(callArgs[1].headers["X-Idempotency-Key"]).toBe("idem-remote-key-1");
    expect(callArgs[1].headers["X-Actor-Id"]).toBe("u-attendant-1");

    expect(res.success).toBe(true);
    expect(res.data?.issueId).toBe("remote-issue-uuid-1");
    expect(res.data?.litres).toBe(45.0);

    vi.unstubAllGlobals();
  });

  it("translates remote RFC 7807 422 Problem Details into structured command failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: {
        get: (h: string) => (h.toLowerCase() === "content-type" ? "application/problem+json" : null),
      },
      json: async () => ({
        type: "https://fuelsystem.erp/errors/INSUFFICIENT_STOCK",
        title: "Insufficient Bulk Tank Stock",
        status: 422,
        detail: "Bulk tank balance (20.0L) is less than requested issue volume (50.0L).",
        code: "INSUFFICIENT_STOCK",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await dispatchIssueFuel(
      {
        assetIdOrCode: "CAB-1001",
        fuelKind: "AUTO_DIESEL",
        litres: 50.0,
      },
      {
        actorId: "u-admin",
        role: "ADMIN",
      }
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INSUFFICIENT_STOCK");
    expect(res.error).toBe("Bulk tank balance (20.0L) is less than requested issue volume (50.0L).");

    vi.unstubAllGlobals();
  });
});

describe("API-02: Architecture Decision Record Verification", () => {
  it("verifies ADR 0004 exists and documents the single-writer architecture", () => {
    const adrPath = path.resolve(
      __dirname,
      "..",
      "docs",
      "adr",
      "0004-fuel-single-writer-and-outbox-gateway.md"
    );

    expect(fs.existsSync(adrPath)).toBe(true);
    const content = fs.readFileSync(adrPath, "utf-8");
    expect(content).toContain("ADR 0004: Fuel Single-Writer Gateway");
    expect(content).toContain("LOCAL_COMMAND");
    expect(content).toContain("REMOTE_API");
    expect(content).toContain("outbox_messages");
    expect(content).toContain("FuelIssued");
    expect(content).toContain("FuelVoided");
  });
});
