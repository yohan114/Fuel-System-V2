import { prisma } from "../db";
import { normalize } from "./xref";

// Editable price books that feed the service sheet's price auto-fill and the
// cross-reference price estimates.

export async function getFilterPriceList(opts: { q?: string; take?: number } = {}) {
  const q = (opts.q || "").trim();
  return prisma.filterPrice.findMany({
    where: q
      ? { OR: [{ supplierCode: { contains: q } }, { description: { contains: q } }, { normalizedCode: { contains: normalize(q) } }] }
      : undefined,
    orderBy: { supplierCode: "asc" },
    take: opts.take ?? 500,
  });
}

export async function getOilPriceList() {
  return prisma.oilPrice.findMany({ orderBy: { code: "asc" } });
}

// Compact price data passed to the service form for client-side auto-fill.
export interface FormPriceData {
  filterPrices: { code: string; cents: number }[];
  oilPrices: { code: string; cents: number }[];
}

export async function getServiceFormPriceData(): Promise<FormPriceData> {
  const [filters, oils] = await Promise.all([
    prisma.filterPrice.findMany({
      where: { unitPriceCents: { gt: 0 } },
      select: { supplierCode: true, unitPriceCents: true },
      orderBy: { supplierCode: "asc" },
    }),
    prisma.oilPrice.findMany({ where: { unitPriceCents: { gt: 0 } }, select: { code: true, unitPriceCents: true } }),
  ]);
  return {
    filterPrices: filters.map((f) => ({ code: f.supplierCode, cents: f.unitPriceCents })),
    oilPrices: oils.map((o) => ({ code: o.code, cents: o.unitPriceCents })),
  };
}
