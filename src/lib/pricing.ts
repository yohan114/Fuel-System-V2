import { prisma } from "./db";

export async function getPriceForDate(fuelKind: string, date: Date) {
  const priceRecord = await prisma.fuelPrice.findFirst({
    where: {
      fuelKind,
      effectiveFrom: {
        lte: date,
      },
    },
    orderBy: {
      effectiveFrom: "desc",
    },
  });

  if (!priceRecord) {
    // Fallback to the oldest available price if no records are before the target date
    const fallback = await prisma.fuelPrice.findFirst({
      where: { fuelKind },
      orderBy: { effectiveFrom: "asc" },
    });
    if (!fallback) {
      throw new Error(`No fuel price records found in system database for fuel kind: ${fuelKind}`);
    }
    return fallback;
  }

  return priceRecord;
}
