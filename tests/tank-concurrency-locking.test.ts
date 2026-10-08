// ============================================================================
// Phase 11 / Step 13: High-Risk Concurrency Controls & Row-Level Locking Test Suite
// Reference: Fuel-System-V3 Plan Section 16 (Concurrency and Race Conditions)
//
// Verifies:
// 1. Deterministic lock ordering (sortTankIdsForLocking) to prevent deadlocks.
// 2. Pessimistic row-locking (lockTankForUpdate) before balance checks.
// 3. executePessimisticStockDeduction prevents overdrafts under race conditions.
// 4. executePessimisticStockCredit enforces physical tank capacity limits.
// 5. executePessimisticStockTransfer enforces atomic debit-before-credit and capacity checks.
// 6. High-concurrency race condition simulation (50 concurrent draws).
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  sortTankIdsForLocking,
  lockTankForUpdate,
  lockTanksInOrder,
  executePessimisticStockDeduction,
  executePessimisticStockCredit,
  executePessimisticStockTransfer,
  InsufficientStockError,
  TankCapacityExceededError,
} from "../src/lib/fuel/tank-lock";

/**
 * Creates an in-memory mock transaction simulating PostgreSQL row-level locks
 * and atomic balance decrements.
 */
function createMockLockingTx(
  initialTanks: Record<string, { name: string; balance: number; capacity?: number; fuelKind?: string }>
) {
  const tanks = new Map<string, { name: string; balance: number; capacity?: number; fuelKind?: string }>();
  for (const [id, data] of Object.entries(initialTanks)) {
    tanks.set(id, { ...data });
  }

  const lockedRows = new Set<string>();

  const tx = {
    $queryRawUnsafe: async (sql: string, ...args: any[]) => {
      if (sql.includes("FOR UPDATE")) {
        const id = args[0];
        const tank = tanks.get(id);
        if (!tank) return [];
        lockedRows.add(id);
        return [{ id, ...tank }];
      }
      return [];
    },

    bulkTank: {
      findUnique: async ({ where }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) return null;
        return { id: where.id, ...tank };
      },

      updateMany: async ({ where, data }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) return { count: 0 };

        if (where.balance && where.balance.gte !== undefined) {
          if (tank.balance < where.balance.gte) {
            return { count: 0 };
          }
        }

        if (data.balance?.decrement !== undefined) {
          tank.balance = Number((tank.balance - data.balance.decrement).toFixed(2));
        }

        return { count: 1 };
      },

      update: async ({ where, data }: any) => {
        const tank = tanks.get(where.id);
        if (!tank) throw new Error(`Tank ${where.id} not found`);

        if (data.balance?.increment !== undefined) {
          tank.balance = Number((tank.balance + data.balance.increment).toFixed(2));
        }

        return { id: where.id, ...tank };
      },
    },

    getTank: (id: string) => tanks.get(id),
    isLocked: (id: string) => lockedRows.has(id),
  };

  return tx;
}

describe("Step 13: Concurrency Controls & Row-Level Locking", () => {
  // --------------------------------------------------------------------------
  // 1. Deadlock Prevention & Deterministic Lock Ordering
  // --------------------------------------------------------------------------
  describe("Deadlock Prevention (Deterministic Lock Ordering)", () => {
    it("sorts tank IDs in consistent alphabetical order regardless of input order", () => {
      const orderA = ["tank-z", "tank-a", "tank-m"];
      const orderB = ["tank-m", "tank-z", "tank-a"];

      const sortedA = sortTankIdsForLocking(orderA);
      const sortedB = sortTankIdsForLocking(orderB);

      expect(sortedA).toEqual(["tank-a", "tank-m", "tank-z"]);
      expect(sortedB).toEqual(["tank-a", "tank-m", "tank-z"]);
    });

    it("deduplicates tank IDs and filters empty strings", () => {
      const input = ["tank-beta", "", "tank-alpha", "tank-beta"];
      const sorted = sortTankIdsForLocking(input);
      expect(sorted).toEqual(["tank-alpha", "tank-beta"]);
    });

    it("acquires locks in sorted order across multi-tank operations", async () => {
      const tx = createMockLockingTx({
        "tank-b": { name: "Bowser 02", balance: 500 },
        "tank-a": { name: "Station Main Tank", balance: 1000 },
      });

      const lockMap = await lockTanksInOrder(tx, ["tank-b", "tank-a"]);

      expect(lockMap.size).toBe(2);
      expect(lockMap.get("tank-a")?.name).toBe("Station Main Tank");
      expect(lockMap.get("tank-b")?.name).toBe("Bowser 02");
      expect(tx.isLocked("tank-a")).toBe(true);
      expect(tx.isLocked("tank-b")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Pessimistic Row Locking & Stock Deduction
  // --------------------------------------------------------------------------
  describe("Pessimistic Stock Deduction", () => {
    it("locks row and deducts fuel when balance is sufficient", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Workshop Pump", balance: 1000, capacity: 5000 },
      });

      const result = await executePessimisticStockDeduction(tx, "tank-1", 350.5);

      expect(result.previousBalance).toBe(1000);
      expect(result.newBalance).toBe(649.5);
      expect(tx.getTank("tank-1")?.balance).toBe(649.5);
      expect(tx.isLocked("tank-1")).toBe(true);
    });

    it("throws InsufficientStockError and leaves balance unchanged when overdrawing", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Site Bowser", balance: 100, capacity: 1000 },
      });

      await expect(
        executePessimisticStockDeduction(tx, "tank-1", 150)
      ).rejects.toThrow(InsufficientStockError);

      expect(tx.getTank("tank-1")?.balance).toBe(100);
    });

    it("rejects non-positive deduction quantities", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Workshop Pump", balance: 500 },
      });

      await expect(executePessimisticStockDeduction(tx, "tank-1", 0)).rejects.toThrow(
        /greater than zero/
      );
      await expect(executePessimisticStockDeduction(tx, "tank-1", -50)).rejects.toThrow(
        /greater than zero/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Physical Tank Capacity Enforcement (Refills & Transfers)
  // --------------------------------------------------------------------------
  describe("Tank Physical Capacity Enforcement", () => {
    it("allows crediting fuel up to the maximum capacity", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Workshop Tank", balance: 4000, capacity: 5000 },
      });

      const result = await executePessimisticStockCredit(tx, "tank-1", 1000);

      expect(result.previousBalance).toBe(4000);
      expect(result.newBalance).toBe(5000);
      expect(tx.getTank("tank-1")?.balance).toBe(5000);
    });

    it("throws TankCapacityExceededError when credit exceeds physical capacity", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Workshop Tank", balance: 4500, capacity: 5000 },
      });

      await expect(
        executePessimisticStockCredit(tx, "tank-1", 600)
      ).rejects.toThrow(TankCapacityExceededError);

      expect(tx.getTank("tank-1")?.balance).toBe(4500);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Atomic Fuel Transfers with Mutual Locking
  // --------------------------------------------------------------------------
  describe("Atomic Stock Transfers", () => {
    it("transfers fuel between tanks atomically", async () => {
      const tx = createMockLockingTx({
        "tank-source": { name: "Main Bulk Tank", balance: 2000, capacity: 10000 },
        "tank-dest": { name: "Mobile Bowser", balance: 500, capacity: 2000 },
      });

      const result = await executePessimisticStockTransfer(
        tx,
        "tank-source",
        "tank-dest",
        800
      );

      expect(result.sourceNewBalance).toBe(1200);
      expect(result.destNewBalance).toBe(1300);
      expect(tx.getTank("tank-source")?.balance).toBe(1200);
      expect(tx.getTank("tank-dest")?.balance).toBe(1300);
    });

    it("rejects transfer when source has insufficient fuel", async () => {
      const tx = createMockLockingTx({
        "tank-source": { name: "Main Tank", balance: 300, capacity: 5000 },
        "tank-dest": { name: "Bowser", balance: 200, capacity: 1000 },
      });

      await expect(
        executePessimisticStockTransfer(tx, "tank-source", "tank-dest", 500)
      ).rejects.toThrow(InsufficientStockError);

      expect(tx.getTank("tank-source")?.balance).toBe(300);
      expect(tx.getTank("tank-dest")?.balance).toBe(200);
    });

    it("rejects transfer when destination capacity would be exceeded", async () => {
      const tx = createMockLockingTx({
        "tank-source": { name: "Main Tank", balance: 2000, capacity: 10000 },
        "tank-dest": { name: "Small Bowser", balance: 800, capacity: 1000 },
      });

      await expect(
        executePessimisticStockTransfer(tx, "tank-source", "tank-dest", 300)
      ).rejects.toThrow(TankCapacityExceededError);

      expect(tx.getTank("tank-source")?.balance).toBe(2000);
      expect(tx.getTank("tank-dest")?.balance).toBe(800);
    });

    it("rejects transfer when source and destination are identical", async () => {
      const tx = createMockLockingTx({
        "tank-1": { name: "Main Tank", balance: 1000, capacity: 5000 },
      });

      await expect(
        executePessimisticStockTransfer(tx, "tank-1", "tank-1", 100)
      ).rejects.toThrow(/must be different/);
    });
  });

  // --------------------------------------------------------------------------
  // 5. High-Concurrency Race Condition Simulation
  // --------------------------------------------------------------------------
  describe("High-Concurrency Race Condition Simulation", () => {
    it("safely resolves 50 concurrent fuel requests without overdraft or balance corruption", async () => {
      const initialBalance = 1000.0;
      const requestLitres = 30.0; // 33 successful draws = 990L, leaving 10L
      const totalRequests = 50;

      const tx = createMockLockingTx({
        "shared-tank": { name: "Central Depot Tank", balance: initialBalance, capacity: 5000 },
      });

      let successfulDraws = 0;
      let rejectedDraws = 0;

      const promises = Array.from({ length: totalRequests }, async () => {
        try {
          await executePessimisticStockDeduction(tx, "shared-tank", requestLitres);
          successfulDraws++;
        } catch (err) {
          if (err instanceof InsufficientStockError) {
            rejectedDraws++;
          } else {
            throw err;
          }
        }
      });

      await Promise.all(promises);

      // 1000 / 30 = 33 full draws
      expect(successfulDraws).toBe(33);
      expect(rejectedDraws).toBe(17);
      expect(successfulDraws + rejectedDraws).toBe(50);

      // Remaining balance must be exactly 10.0L
      const finalBalance = tx.getTank("shared-tank")?.balance;
      expect(finalBalance).toBe(10.0);
      expect(finalBalance).toBeGreaterThanOrEqual(0);
    });
  });
});
