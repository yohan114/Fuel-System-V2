import { prisma } from "../db";
import { DEFAULT_OILS, DEFAULT_FILTER_CATEGORIES } from "./defaults";

// Master lists that drive the rows of the service sheet. Read from the DB
// (where they are editable) and fall back to the seed defaults so the capture
// form still works on a database that has not been seeded yet.

export interface OilLine {
  name: string;
  unit: string;
  unitPriceCents: number;
}

export interface FilterLine {
  name: string;
  unitPriceCents: number;
}

export async function getOilLines(): Promise<OilLine[]> {
  const rows = await prisma.oilType.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, unit: true, unitPriceCents: true },
  });
  if (rows.length > 0) return rows;
  return DEFAULT_OILS.map((o) => ({ name: o.name, unit: o.unit, unitPriceCents: 0 }));
}

export async function getFilterLines(): Promise<FilterLine[]> {
  const rows = await prisma.filterCategoryRef.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, unitPriceCents: true },
  });
  if (rows.length > 0) return rows;
  return DEFAULT_FILTER_CATEGORIES.map((name) => ({ name, unitPriceCents: 0 }));
}
