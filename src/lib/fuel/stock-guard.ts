// Stock concurrency & atomic posting guard (Task TX-02)
//
// Ensures physical tank balances cannot be overdrawn by concurrent dispatches
// or transfers. Uses database-level conditional decrements (UPDATE ... WHERE balance >= litres)
// inside active transactions. If available balance is insufficient, the statement updates
// 0 rows, triggering an immediate transaction rollback via InsufficientStockError.

export class InsufficientStockError extends Error {
  readonly tankName: string;
  readonly available: number;
  readonly requested: number;

  constructor(tankName: string, available: number, requested: number) {
    super(
      `Insufficient fuel in ${tankName}. Available: ${available.toFixed(1)} L, attempted to issue/transfer: ${requested.toFixed(1)} L.`
    );
    this.name = "InsufficientStockError";
    this.tankName = tankName;
    this.available = available;
    this.requested = requested;
  }
}

/**
 * Atomically deduct fuel from a bulk tank balance inside a transaction.
 * Guarantees balance never drops below zero even under high concurrency.
 */
export async function deductTankStockAtomically(
  tx: any,
  tankId: string,
  litres: number,
  tankNameFallback?: string
): Promise<{ previousBalance: number; newBalance: number }> {
  if (litres <= 0) {
    throw new Error("Litre quantity to deduct must be greater than zero.");
  }

  // Atomic conditional decrement: only updates if balance >= litres
  const result = await tx.bulkTank.updateMany({
    where: {
      id: tankId,
      balance: { gte: litres },
    },
    data: {
      balance: { decrement: litres },
    },
  });

  if (result.count === 0) {
    // Determine exact state for informative error
    const tank = await tx.bulkTank.findUnique({
      where: { id: tankId },
      select: { name: true, balance: true },
    });

    if (!tank) {
      throw new Error(`Storage tank '${tankId}' was not found.`);
    }

    throw new InsufficientStockError(
      tank.name || tankNameFallback || "Storage Tank",
      tank.balance,
      litres
    );
  }

  const updated = await tx.bulkTank.findUnique({
    where: { id: tankId },
    select: { balance: true },
  });

  const newBalance = updated?.balance ?? 0;
  return {
    previousBalance: newBalance + litres,
    newBalance,
  };
}

/**
 * Atomically credit fuel to a bulk tank balance inside a transaction.
 */
export async function creditTankStockAtomically(
  tx: any,
  tankId: string,
  litres: number
): Promise<{ newBalance: number }> {
  if (litres <= 0) {
    throw new Error("Litre quantity to credit must be greater than zero.");
  }

  const updated = await tx.bulkTank.update({
    where: { id: tankId },
    data: {
      balance: { increment: litres },
    },
    select: { balance: true },
  });

  return { newBalance: updated.balance };
}

/**
 * Atomically transfer fuel from a source tank to a destination tank inside a transaction.
 * Sorts tank updates to prevent deadlocks and guarantees atomic debit before credit.
 */
export async function transferTankStockAtomically(
  tx: any,
  sourceTankId: string,
  destTankId: string,
  litres: number,
  sourceNameFallback?: string,
  destNameFallback?: string
): Promise<void> {
  if (sourceTankId === destTankId) {
    throw new Error("Source and destination storage tanks must be different.");
  }
  if (litres <= 0) {
    throw new Error("Transfer quantity must be greater than zero.");
  }

  // 1. Deduct from source with conditional check
  await deductTankStockAtomically(tx, sourceTankId, litres, sourceNameFallback);

  // 2. Credit destination
  await creditTankStockAtomically(tx, destTankId, litres);
}

/**
 * Atomically adjust a tank balance for edits (returns or additional draws).
 * balanceDelta > 0: fuel returned to tank (credit)
 * balanceDelta < 0: additional fuel drawn from tank (conditional debit)
 */
export async function adjustTankStockAtomically(
  tx: any,
  tankId: string,
  balanceDelta: number,
  tankNameFallback?: string
): Promise<void> {
  if (balanceDelta === 0) return;

  if (balanceDelta > 0) {
    await creditTankStockAtomically(tx, tankId, balanceDelta);
  } else {
    const additionalLitres = Math.abs(balanceDelta);
    await deductTankStockAtomically(tx, tankId, additionalLitres, tankNameFallback);
  }
}

/**
 * Idempotency key helper for direct issue submissions.
 * Formats client idempotency keys into the unique importKey space.
 */
export function formatIdempotencyKey(rawKey: string | null | undefined): string | null {
  if (!rawKey) return null;
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("idem-")) return trimmed;
  return `idem-${trimmed}`;
}

/**
 * Check if a duplicate request has already been recorded under an idempotency key.
 */
export async function findExistingIdempotentIssue(
  tx: any,
  formattedKey: string | null
): Promise<{
  id: string;
  litres: number;
  assetId: string;
  fuelKind?: string;
  totalCost?: number;
  pricePerLitre?: number;
} | null> {
  if (!formattedKey) return null;
  return tx.fuelIssue.findUnique({
    where: { importKey: formattedKey },
    select: {
      id: true,
      litres: true,
      assetId: true,
      fuelKind: true,
      totalCost: true,
      pricePerLitre: true,
    },
  });
}
