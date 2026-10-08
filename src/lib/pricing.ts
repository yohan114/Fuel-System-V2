import { prisma } from "./db";
import { getCachedPriceForDate } from "./cache/reference-cache";

export async function getPriceForDate(fuelKind: string, date: Date) {
  return getCachedPriceForDate(fuelKind, date, prisma);
}
