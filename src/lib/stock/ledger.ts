import { prisma } from "../db";
import { round3 } from "./classify";

// Running-balance ledger for the oil/lubricant stock book (ported from Oil
// Stock Book's `server/ledger.js`). The canonical order is
// (txnDate, createdAt, id): the importer assigns monotonically increasing
// createdAt so imported rows reproduce the official book row-for-row even when
// dates tie, and a later-entered (or back-dated) movement sorts after same-day
// rows that already existed — matching the original integer-id semantics.

const LEDGER_ORDER = [
  { txnDate: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

/**
 * Recompute and persist the running balance for one product's ledger.
 * Returns the final (current) balance. Only rows whose balance actually
 * changed are written, so a no-op recompute touches nothing.
 */
export async function recomputeLedger(productId: string): Promise<number> {
  const rows = await prisma.stockMovement.findMany({
    where: { productId, voided: false },
    orderBy: LEDGER_ORDER,
    select: { id: true, qtyReceived: true, qtyIssued: true, balanceAfter: true },
  });

  let running = 0;
  const updates: { id: string; balanceAfter: number }[] = [];
  for (const r of rows) {
    running = round3(running + r.qtyReceived - r.qtyIssued);
    if (running !== r.balanceAfter) updates.push({ id: r.id, balanceAfter: running });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.stockMovement.update({
          where: { id: u.id },
          data: { balanceAfter: u.balanceAfter },
        }),
      ),
    );
  }
  return running;
}

/** Current balance = balanceAfter of the latest non-voided movement. */
export async function currentBalance(productId: string): Promise<number> {
  const row = await prisma.stockMovement.findFirst({
    where: { productId, voided: false },
    orderBy: [
      { txnDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { balanceAfter: true },
  });
  return row ? row.balanceAfter : 0;
}

/**
 * Current balances for every product in one query, returned as a Map keyed by
 * productId. Used by the dashboard / low-stock alerts so we don't N+1 the
 * ledger. Computed from the signed sum of non-voided movements (equivalent to
 * the last row's balanceAfter once `recomputeLedger` has run).
 */
export async function currentBalances(): Promise<Map<string, number>> {
  const grouped = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { voided: false },
    _sum: { qtyReceived: true, qtyIssued: true },
  });
  const out = new Map<string, number>();
  for (const g of grouped) {
    out.set(g.productId, round3((g._sum.qtyReceived ?? 0) - (g._sum.qtyIssued ?? 0)));
  }
  return out;
}
