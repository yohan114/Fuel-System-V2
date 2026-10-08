// Concurrency & Stock Balance Guards (Master Plan Task TX-02)
//
// Verifies:
// 1. Conditional stock deduction prevents negative balances (balance >= litres)
// 2. Insufficient stock throws InsufficientStockError and stops transaction
// 3. Simulated race conditions (concurrent requests) prevent overdraw
// 4. Atomic transfers enforce source debit before destination credit
// 5. Adjustments and returns correctly credit/debit balances
// 6. Idempotency key parsing and replay detection prevent duplicate dispatches

import { describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  deductTankStockAtomically,
  creditTankStockAtomically,
  transferTankStockAtomically,
  adjustTankStockAtomically,
  formatIdempotencyKey,
  findExistingIdempotentIssue,
} from "../src/lib/fuel/stock-guard";

/**
 * Creates an in-memory mock transaction runner that accurately simulates
 * Prisma's conditional updateMany ({ where: { balance: { gte: litres } } })
 * and update operations.
 */
function createMockTx(initialTanks: Record<string, { name: string; balance: number }>) {
  const tanks = new Map<string, { name: string; balance: number }>();
  for (const [id, data] of Object.entries(initialTanks)) {
    tanks.set(id, { ...data });
  }

  const issues = new Map<string, { id: string; litres: number; assetId: string; importKey: string }>();

  const tx = {
    bulkTank: {
      updateMany: async ({ where, data }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) return { count: 0 };

        if (where.balance && where.balance.gte !== undefined) {
          if (tank.balance < where.balance.gte) {
            return { count: 0 }; // Conditional update failed: insufficient stock
          }
        }

        if (data.balance?.decrement !== undefined) {
          tank.balance -= data.balance.decrement;
        } else if (data.balance?.increment !== undefined) {
          tank.balance += data.balance.increment;
        }

        return { count: 1 };
      },

      update: async ({ where, data, select }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) throw new Error(`Tank ${where.id} not found`);

        if (data.balance?.increment !== undefined) {
          tank.balance += data.balance.increment;
        } else if (data.balance?.decrement !== undefined) {
          tank.balance -= data.balance.decrement;
        }

        return { ...tank };
      },

      findUnique: async ({ where }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) return null;
        return { ...tank };
      },
    },

    fuelIssue: {
      findUnique: async ({ where }: any) => {
        if (where.importKey) {
          for (const issue of issues.values()) {
            if (issue.importKey === where.importKey) {
              return { ...issue };
            }
          }
          return null;
        }
        return issues.get(where.id) ?? null;
      },
      create: async ({ data }: any) => {
        const id = `issue-${Math.random().toString(36).slice(2, 8)}`;
        const record = { id, ...data };
        if (data.importKey && issues.has(data.importKey)) {
          throw new Error(`Unique constraint failed on importKey: ${data.importKey}`);
        }
        issues.set(id, record);
        return record;
      },
    },

    // Helper to inspect mock state
    getTankBalance: (id: string) => tanks.get(id)?.balance,
    addIssue: (issue: { id: string; litres: number; assetId: string; importKey: string }) => {
      issues.set(issue.id, issue);
    },
  };

  return tx;
}

describe("TX-02: Stock Balance Guards (deductTankStockAtomically)", () => {
  it("successfully deducts stock when balance is sufficient", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Workshop Main Pump", balance: 1000.0 },
    });

    const result = await deductTankStockAtomically(tx, "tank-1", 250.0);
    expect(result.previousBalance).toBe(1000.0);
    expect(result.newBalance).toBe(750.0);
    expect(tx.getTankBalance("tank-1")).toBe(750.0);
  });

  it("allows deducting the exact full balance down to zero", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Workshop Main Pump", balance: 500.0 },
    });

    const result = await deductTankStockAtomically(tx, "tank-1", 500.0);
    expect(result.previousBalance).toBe(500.0);
    expect(result.newBalance).toBe(0.0);
    expect(tx.getTankBalance("tank-1")).toBe(0.0);
  });

  it("throws InsufficientStockError and leaves balance unchanged when overdrawing", async () => {
    const tx = createMockTx({
      "tank-1": { name: "CEP-03 F Galagedara Tank", balance: 120.0 },
    });

    await expect(
      deductTankStockAtomically(tx, "tank-1", 150.0)
    ).rejects.toThrow(InsufficientStockError);

    // Balance must be preserved exactly without going negative
    expect(tx.getTankBalance("tank-1")).toBe(120.0);
  });

  it("InsufficientStockError carries detailed context for operator feedback", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Marawila Site Tank", balance: 45.5 },
    });

    try {
      await deductTankStockAtomically(tx, "tank-1", 100.0);
      expect.fail("Should have thrown InsufficientStockError");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientStockError);
      const e = err as InsufficientStockError;
      expect(e.tankName).toBe("Marawila Site Tank");
      expect(e.available).toBe(45.5);
      expect(e.requested).toBe(100.0);
      expect(e.message).toContain("Insufficient fuel in Marawila Site Tank");
      expect(e.message).toContain("Available: 45.5 L");
      expect(e.message).toContain("attempted to issue/transfer: 100.0 L");
    }
  });

  it("rejects non-positive litre requests", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Pump", balance: 500 },
    });

    await expect(deductTankStockAtomically(tx, "tank-1", 0)).rejects.toThrow(
      "Litre quantity to deduct must be greater than zero."
    );
    await expect(deductTankStockAtomically(tx, "tank-1", -10)).rejects.toThrow(
      "Litre quantity to deduct must be greater than zero."
    );
  });

  it("throws when tank does not exist", async () => {
    const tx = createMockTx({});
    await expect(
      deductTankStockAtomically(tx, "ghost-tank", 50)
    ).rejects.toThrow("Storage tank 'ghost-tank' was not found.");
  });
});

describe("TX-02: Concurrent Race Condition Protection", () => {
  it("rejects overdraw when two concurrent dispatches exceed balance", async () => {
    // Starting balance: 1,000 L. Two concurrent issues request 600 L each.
    // Total requested = 1,200 L. Exactly ONE must succeed, and ONE must be rejected.
    const tx = createMockTx({
      "tank-1": { name: "Central Tank", balance: 1000.0 },
    });

    const results = await Promise.allSettled([
      deductTankStockAtomically(tx, "tank-1", 600.0),
      deductTankStockAtomically(tx, "tank-1", 600.0),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Final balance must be 400 L, NOT -200 L
    expect(tx.getTankBalance("tank-1")).toBe(400.0);

    const failure = (rejected[0] as PromiseRejectedResult).reason;
    expect(failure).toBeInstanceOf(InsufficientStockError);
  });

  it("allows multiple concurrent dispatches if combined sum is within balance", async () => {
    const tx = createMockTx({
      "tank-1": { name: "High Volume Pump", balance: 1000.0 },
    });

    const results = await Promise.allSettled([
      deductTankStockAtomically(tx, "tank-1", 200.0),
      deductTankStockAtomically(tx, "tank-1", 300.0),
      deductTankStockAtomically(tx, "tank-1", 400.0),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(3);
    expect(tx.getTankBalance("tank-1")).toBe(100.0);
  });
});

describe("TX-02: Atomic Tank Transfers (transferTankStockAtomically)", () => {
  it("transfers stock from source to destination atomically", async () => {
    const tx = createMockTx({
      "source-tank": { name: "Workshop Main", balance: 5000.0 },
      "dest-tank": { name: "Badalgama Site Tank", balance: 700.0 },
    });

    await transferTankStockAtomically(tx, "source-tank", "dest-tank", 1500.0);

    expect(tx.getTankBalance("source-tank")).toBe(3500.0);
    expect(tx.getTankBalance("dest-tank")).toBe(2200.0);
  });

  it("aborts transfer and leaves destination untouched if source is insufficient", async () => {
    const tx = createMockTx({
      "source-tank": { name: "Workshop Main", balance: 400.0 },
      "dest-tank": { name: "Badalgama Site Tank", balance: 700.0 },
    });

    await expect(
      transferTankStockAtomically(tx, "source-tank", "dest-tank", 500.0)
    ).rejects.toThrow(InsufficientStockError);

    // Source and destination balances must remain completely unchanged
    expect(tx.getTankBalance("source-tank")).toBe(400.0);
    expect(tx.getTankBalance("dest-tank")).toBe(700.0);
  });

  it("rejects transfer between the same tank", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Main Tank", balance: 1000.0 },
    });

    await expect(
      transferTankStockAtomically(tx, "tank-1", "tank-1", 200.0)
    ).rejects.toThrow("Source and destination storage tanks must be different.");
  });
});

describe("TX-02: Balance Adjustments (adjustTankStockAtomically)", () => {
  it("credits tank when balanceDelta is positive (fuel returned)", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Site Tank", balance: 500.0 },
    });

    await adjustTankStockAtomically(tx, "tank-1", 50.0);
    expect(tx.getTankBalance("tank-1")).toBe(550.0);
  });

  it("debits tank conditionally when balanceDelta is negative (additional draw)", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Site Tank", balance: 500.0 },
    });

    await adjustTankStockAtomically(tx, "tank-1", -150.0);
    expect(tx.getTankBalance("tank-1")).toBe(350.0);
  });

  it("throws InsufficientStockError when negative balanceDelta exceeds available stock", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Site Tank", balance: 80.0 },
    });

    await expect(
      adjustTankStockAtomically(tx, "tank-1", -100.0)
    ).rejects.toThrow(InsufficientStockError);

    expect(tx.getTankBalance("tank-1")).toBe(80.0);
  });

  it("does nothing when balanceDelta is zero", async () => {
    const tx = createMockTx({
      "tank-1": { name: "Site Tank", balance: 500.0 },
    });

    await adjustTankStockAtomically(tx, "tank-1", 0);
    expect(tx.getTankBalance("tank-1")).toBe(500.0);
  });
});

describe("TX-02: Idempotency Key Formatting & Replay Detection", () => {
  it("formats raw idempotency keys with idem- prefix", () => {
    expect(formatIdempotencyKey("req-12345")).toBe("idem-req-12345");
    expect(formatIdempotencyKey("idem-already-prefixed")).toBe("idem-already-prefixed");
    expect(formatIdempotencyKey("  uuid-abc-def  ")).toBe("idem-uuid-abc-def");
  });

  it("returns null for empty, whitespace, or null keys", () => {
    expect(formatIdempotencyKey(null)).toBeNull();
    expect(formatIdempotencyKey(undefined)).toBeNull();
    expect(formatIdempotencyKey("")).toBeNull();
    expect(formatIdempotencyKey("   ")).toBeNull();
  });

  it("detects existing idempotent issues", async () => {
    const tx = createMockTx({});
    tx.addIssue({
      id: "issue-abc",
      litres: 120.0,
      assetId: "asset-1",
      importKey: "idem-tx-20261008-01",
    });

    const found = await findExistingIdempotentIssue(tx, "idem-tx-20261008-01");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("issue-abc");
    expect(found?.litres).toBe(120.0);

    const notFound = await findExistingIdempotentIssue(tx, "idem-unknown-key");
    expect(notFound).toBeNull();
  });

  it("returns null if formattedKey is null", async () => {
    const tx = createMockTx({});
    const found = await findExistingIdempotentIssue(tx, null);
    expect(found).toBeNull();
  });
});
