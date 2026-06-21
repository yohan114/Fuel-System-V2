import { prisma } from "../db";

// Bulk-tank reconciliation. The app keeps an authoritative running `balance`
// per tank (maintained by approvals, transfers and workshop draws). A periodic
// physical dip measures the real level; a persistent gap between the dip and
// the stored balance flags shrinkage, leakage or unrecorded draws.

export interface TankRecon {
  id: string;
  name: string;
  fuelKind: string;
  capacity: number;
  balance: number; // stored running balance
  totalIssued: number; // lifetime litres drawn (non-voided)
  totalToppedUp: number; // lifetime approved replenishment litres
  lastDip: { dipLitres: number; variance: number; dipDate: Date; note: string | null } | null;
  currentVariance: number | null; // lastDip.dipLitres − balance
  fillPct: number; // balance / capacity
  lowBalance: boolean; // below 10% of capacity
}

const LOW_BALANCE_PCT = 0.1;

export async function getTankReconciliation(): Promise<TankRecon[]> {
  const tanks = await prisma.bulkTank.findMany({ orderBy: { name: "asc" } });

  const rows = await Promise.all(
    tanks.map(async (t) => {
      const [issuedAgg, toppedAgg, lastDip] = await Promise.all([
        prisma.fuelIssue.aggregate({
          where: { bulkTankId: t.id, voided: false },
          _sum: { litres: true },
        }),
        prisma.bulkRequest.aggregate({
          where: { bulkTankId: t.id, status: "APPROVED" },
          _sum: { requestedLitres: true },
        }),
        prisma.tankDip.findFirst({ where: { bulkTankId: t.id }, orderBy: { dipDate: "desc" } }),
      ]);

      const fillPct = t.capacity > 0 ? t.balance / t.capacity : 0;
      return {
        id: t.id,
        name: t.name,
        fuelKind: t.fuelKind,
        capacity: t.capacity,
        balance: t.balance,
        totalIssued: issuedAgg._sum.litres ?? 0,
        totalToppedUp: toppedAgg._sum.requestedLitres ?? 0,
        lastDip: lastDip
          ? { dipLitres: lastDip.dipLitres, variance: lastDip.variance, dipDate: lastDip.dipDate, note: lastDip.note }
          : null,
        currentVariance: lastDip ? lastDip.dipLitres - t.balance : null,
        fillPct,
        lowBalance: fillPct < LOW_BALANCE_PCT,
      };
    })
  );

  return rows;
}
