import { prisma } from "./db";

// Site fuel discipline: an optional per-vehicle daily litre cap. Before a fuel
// issue is created (direct or via request approval), we sum the vehicle's
// non-voided litres already issued that calendar day; if this issue would push
// the day's total past the cap, it's blocked at the source — closing the
// runaway-drawdown gap. Returns an error message to surface, or null when OK.
export async function checkDailyCap(
  assetId: string,
  cap: number | null | undefined,
  issueDate: Date,
  litres: number
): Promise<string | null> {
  if (cap == null) return null;

  const dayStart = new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth(), issueDate.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const agg = await prisma.fuelIssue.aggregate({
    _sum: { litres: true },
    where: { assetId, voided: false, issueDate: { gte: dayStart, lt: dayEnd } },
  });
  const already = agg._sum.litres ?? 0;

  if (already + litres > cap) {
    const remaining = Math.max(0, cap - already);
    return `Daily fuel cap reached — ${already} L already issued to this vehicle today; only ${remaining} L of the ${cap} L/day cap remains, so ${litres} L cannot be issued.`;
  }
  return null;
}
