import { prisma } from "../db";
import { normalize } from "./xref";
import { filterDemand } from "./demand";

export type StockReason = "RECEIPT" | "CONSUMPTION" | "ADJUSTMENT" | "OPENING";

/**
 * The normalized key a filter line maps to — the SAME key the demand / reorder
 * engine uses (normalized part number, falling back to its category) so the
 * stock ledger lines up exactly with the Reorder Planner.
 */
export function stockKey(filterNo: string | null | undefined, category: string | null | undefined): string {
  const norm = normalize(filterNo);
  return norm || `CAT::${(category || "UNKNOWN").toUpperCase()}`;
}

export interface PostMovementInput {
  normalizedCode: string;
  filterNo?: string | null;
  delta: number; // signed: +in / -out
  reason: StockReason;
  note?: string | null;
  unitCostCents?: number | null;
  serviceRecordId?: string | null;
  createdById?: string | null;
}

/**
 * Apply a single stock movement: adjust FilterStock.onHand by `delta` and write
 * a ledger row carrying the running balance. The upsert's increment is atomic,
 * so `balanceAfter` reflects exactly this movement's effect. Returns the new
 * on-hand. A zero delta is a no-op (no ledger noise).
 */
export async function postStockMovement(input: PostMovementInput): Promise<number> {
  const delta = Math.trunc(input.delta);
  if (!input.normalizedCode || delta === 0) {
    if (!input.normalizedCode) return 0;
    const cur = await prisma.filterStock.findUnique({ where: { normalizedCode: input.normalizedCode } });
    return cur?.onHand ?? 0;
  }

  const filterNo = input.filterNo?.trim() || null;
  const stock = await prisma.filterStock.upsert({
    where: { normalizedCode: input.normalizedCode },
    create: { normalizedCode: input.normalizedCode, filterNo, onHand: delta },
    update: { onHand: { increment: delta }, ...(filterNo ? { filterNo } : {}) },
  });

  await prisma.filterStockMovement.create({
    data: {
      normalizedCode: input.normalizedCode,
      filterNo: filterNo ?? stock.filterNo ?? null,
      delta,
      reason: input.reason,
      note: input.note?.trim() || null,
      unitCostCents: input.unitCostCents ?? null,
      balanceAfter: stock.onHand,
      serviceRecordId: input.serviceRecordId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return stock.onHand;
}

/**
 * Set on-hand to an absolute target by posting the difference as an ADJUSTMENT
 * (so manual edits are audited rather than silently overwritten). No-op when the
 * stock is already at the target.
 */
export async function setStockTo(
  normalizedCode: string,
  target: number,
  opts: { filterNo?: string | null; createdById?: string | null; note?: string | null } = {},
): Promise<number> {
  const current = (await prisma.filterStock.findUnique({ where: { normalizedCode } }))?.onHand ?? 0;
  const goal = Math.max(0, Math.trunc(target));
  const delta = goal - current;
  if (delta === 0) return current;
  return postStockMovement({
    normalizedCode,
    filterNo: opts.filterNo ?? null,
    delta,
    reason: "ADJUSTMENT",
    note: opts.note ?? `Set on-hand to ${goal}`,
    createdById: opts.createdById ?? null,
  });
}

interface ConsumedLine {
  filterCategory: string;
  filterNo: string | null;
  quantity: number;
}

/**
 * Post CONSUMPTION movements for the filters a service used. Lines are merged by
 * key so two lines of the same filter net to one movement. Best-effort: the
 * caller wraps this so a ledger hiccup never blocks logging the service.
 */
export async function postServiceConsumption(
  serviceRecordId: string,
  lines: ConsumedLine[],
  createdById: string | null,
): Promise<void> {
  const merged = new Map<string, { filterNo: string | null; qty: number }>();
  for (const l of lines) {
    const qty = Math.trunc(Number(l.quantity) || 0);
    if (qty <= 0) continue;
    const key = stockKey(l.filterNo, l.filterCategory);
    const e = merged.get(key);
    if (e) {
      e.qty += qty;
      if (!e.filterNo && l.filterNo) e.filterNo = l.filterNo;
    } else {
      merged.set(key, { filterNo: l.filterNo, qty });
    }
  }

  for (const [key, e] of merged) {
    await postStockMovement({
      normalizedCode: key,
      filterNo: e.filterNo,
      delta: -e.qty,
      reason: "CONSUMPTION",
      serviceRecordId,
      createdById,
    });
  }
}

export interface StockOverviewRow {
  key: string;
  filterNo: string | null;
  category: string;
  onHand: number;
  monthlyQty: number;
  monthsCover: number | null; // onHand / monthly demand; null when there is no demand
  avgUnitCents: number | null;
  valueCents: number | null; // onHand × avg unit price
}

export interface StockOverview {
  rows: StockOverviewRow[];
  skuCount: number;
  totalUnits: number;
  totalValueCents: number;
  lowStockCount: number; // items with demand but under one month of cover
  months: number;
}

/**
 * Inventory view: every filter we have demand for (last 12 months) joined with
 * its on-hand stock, plus any stock-only items received but not yet seen in a
 * service. Value and months-of-cover use the demand-derived average unit price.
 */
export async function stockOverview(): Promise<StockOverview> {
  const months = 12;
  const [{ rows: demand }, stocks] = await Promise.all([
    filterDemand(months),
    prisma.filterStock.findMany(),
  ]);
  const stockMap = new Map(stocks.map((s) => [s.normalizedCode, s]));

  const rows: StockOverviewRow[] = [];
  const seen = new Set<string>();

  for (const d of demand) {
    seen.add(d.key);
    const onHand = stockMap.get(d.key)?.onHand ?? 0;
    rows.push({
      key: d.key,
      filterNo: d.filterNo,
      category: d.category,
      onHand,
      monthlyQty: d.monthlyQty,
      monthsCover: d.monthlyQty > 0 ? onHand / d.monthlyQty : null,
      avgUnitCents: d.avgUnitCents,
      valueCents: d.avgUnitCents != null ? onHand * d.avgUnitCents : null,
    });
  }

  // Stock we hold for filters with no recent demand (e.g. just received).
  for (const s of stocks) {
    if (seen.has(s.normalizedCode) || s.onHand === 0) continue;
    rows.push({
      key: s.normalizedCode,
      filterNo: s.filterNo,
      category: s.normalizedCode.startsWith("CAT::") ? s.normalizedCode.slice(5) : "—",
      onHand: s.onHand,
      monthlyQty: 0,
      monthsCover: null,
      avgUnitCents: null,
      valueCents: null,
    });
  }

  rows.sort(
    (a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0) || b.onHand - a.onHand || b.monthlyQty - a.monthlyQty,
  );

  const totalUnits = rows.reduce((s, r) => s + r.onHand, 0);
  const totalValueCents = rows.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const lowStockCount = rows.filter(
    (r) => r.monthlyQty > 0 && r.monthsCover != null && r.monthsCover < 1,
  ).length;

  return { rows, skuCount: rows.length, totalUnits, totalValueCents, lowStockCount, months };
}

export interface LedgerEntry {
  id: string;
  normalizedCode: string;
  filterNo: string | null;
  delta: number;
  reason: string;
  note: string | null;
  unitCostCents: number | null;
  balanceAfter: number;
  createdAt: Date;
  actorName: string | null;
}

/** Recent movements across all filters, newest first, with actor names resolved. */
export async function recentStockMovements(limit = 50): Promise<LedgerEntry[]> {
  const moves = await prisma.filterStockMovement.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const actorIds = [...new Set(moves.map((m) => m.createdById).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  return moves.map((m) => ({
    id: m.id,
    normalizedCode: m.normalizedCode,
    filterNo: m.filterNo,
    delta: m.delta,
    reason: m.reason,
    note: m.note,
    unitCostCents: m.unitCostCents,
    balanceAfter: m.balanceAfter,
    createdAt: m.createdAt,
    actorName: m.createdById ? nameById.get(m.createdById) ?? null : null,
  }));
}
