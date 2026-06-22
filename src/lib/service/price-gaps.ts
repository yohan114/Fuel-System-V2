import { prisma } from "../db";
import { filterDemand } from "./demand";

export interface PriceGapRow {
  key: string;
  filterNo: string;
  category: string;
  monthlyQty: number;
  serviceCount: number;
  vehicleCount: number;
  monthlyCostCents: number;
  suggestedCents: number | null;
}

/**
 * Filters actually used in service (with a part number) that have no entry in
 * the price book. The suggested price is the average actually paid at service
 * time, so the admin can confirm-and-save in one tap. Sorted by impact
 * (monthly spend), so the highest-leverage gaps come first.
 */
export async function findPriceGaps(months = 12): Promise<{ gaps: PriceGapRow[]; count: number; withSuggestion: number }> {
  const [{ rows: demand }, prices] = await Promise.all([
    filterDemand(months),
    prisma.filterPrice.findMany({ where: { unitPriceCents: { gt: 0 } }, select: { normalizedCode: true } }),
  ]);
  const priced = new Set(prices.map((p) => p.normalizedCode).filter(Boolean));

  const gaps: PriceGapRow[] = demand
    .filter((r) => r.filterNo && !priced.has(r.key))
    .map((r) => ({
      key: r.key,
      filterNo: r.filterNo as string,
      category: r.category,
      monthlyQty: r.monthlyQty,
      serviceCount: r.serviceCount,
      vehicleCount: r.vehicleCount,
      monthlyCostCents: r.monthlyCostCents,
      suggestedCents: r.avgUnitCents,
    }));

  return { gaps, count: gaps.length, withSuggestion: gaps.filter((g) => g.suggestedCents != null).length };
}
