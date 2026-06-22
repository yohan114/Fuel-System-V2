import { prisma } from "../db";
import { filterDemand, type DemandRow } from "./demand";

export interface ReorderRow extends DemandRow {
  onHand: number;
  targetQty: number;
  orderQty: number;
  orderCostCents: number | null;
  unpriced: boolean;
}

export interface ReorderOptions {
  coverMonths?: number;
  leadMonths?: number;
  months?: number;
}

/**
 * Turns demand into an actionable purchase list. Target stock covers
 * (coverMonths + leadMonths) of demand; quantity to order is the shortfall
 * against on-hand. Rows with no known price are flagged (still listed, since
 * they may still need ordering).
 */
export async function computeReorder({ coverMonths = 3, leadMonths = 1, months = 12 }: ReorderOptions = {}) {
  const totalCover = Math.max(0, coverMonths) + Math.max(0, leadMonths);
  const [{ rows: demand }, stocks] = await Promise.all([
    filterDemand(months),
    prisma.filterStock.findMany(),
  ]);
  const stockMap = new Map(stocks.map((s) => [s.normalizedCode, s.onHand]));

  const all: ReorderRow[] = demand.map((d) => {
    const onHand = stockMap.get(d.key) ?? 0;
    const targetQty = Math.ceil(d.monthlyQty * totalCover);
    const orderQty = Math.max(0, targetQty - onHand);
    const orderCostCents = d.avgUnitCents != null ? orderQty * d.avgUnitCents : null;
    return { ...d, onHand, targetQty, orderQty, orderCostCents, unpriced: d.avgUnitCents == null };
  });

  const rows = all
    .filter((r) => r.orderQty > 0)
    .sort((a, b) => (b.orderCostCents ?? 0) - (a.orderCostCents ?? 0) || b.orderQty - a.orderQty);

  const totalCostCents = rows.reduce((s, r) => s + (r.orderCostCents ?? 0), 0);
  const unpricedCount = rows.filter((r) => r.unpriced).length;

  return { rows, totalCostCents, unpricedCount, coverMonths, leadMonths, totalCover, months };
}
