import { prisma } from "@/lib/db";
import { apportionCents, explodeBillsBySite, type ExplodedBill } from "./site-explode";
import { buildSiteStatements, totalStatement, type SiteStatement, type StatementTotals } from "./statement";

export interface ConsolidatedData {
  bills: ExplodedBill[];
  statements: SiteStatement[];
  stmtTotals: StatementTotals;
  /** Real bills behind the portions — what "N vehicles billed" actually means. */
  sourceBillCount: number;
  /** How many of those were split across more than one site. */
  splitBillCount: number;
}

/**
 * Load a month's billing already distributed to the sites that earned it.
 *
 * The site filter is applied AFTER the split, not in the query. A vehicle can
 * finish the month at Awissawella having spent twelve days at Galagedara;
 * filtering on Bill.projectCode up front would drop it from Galagedara's
 * statement even though Galagedara owes for those twelve days.
 *
 * Credit notes and payments are booked against the whole bill, so they are
 * apportioned by the same site shares — otherwise a site's outstanding balance
 * would be its full charge less somebody else's credit.
 */
export async function loadConsolidatedBilling(
  year: number,
  month: number,
  siteCode: string | null
): Promise<ConsolidatedData> {
  const [sourceBills, projects] = await Promise.all([
    prisma.bill.findMany({
      where: { year, month },
      include: {
        lineItems: {
          // unitRateCents is needed to state the rate each SITE was charged at.
          // Without it the split fell back to the bill's dominant rate and a
          // per-site page printed units it could not be multiplied by.
          select: { kind: true, description: true, quantity: true, unitRateCents: true, amountCents: true, projectId: true, projectName: true },
        },
      },
      orderBy: [{ projectName: "asc" }, { assetCode: "asc" }],
    }),
    prisma.project.findMany({ select: { id: true, code: true } }),
  ]);

  const codeById = new Map(projects.map((p) => [p.id, p.code]));
  const exploded = explodeBillsBySite(sourceBills, codeById);

  const billIds = sourceBills.map((b) => b.id);
  const [creditRows, paymentRows] = await Promise.all([
    prisma.creditNote.findMany({ where: { billId: { in: billIds } } }),
    prisma.payment.findMany({ where: { billId: { in: billIds } }, orderBy: { paidDate: "asc" } }),
  ]);

  // Portions of the same bill, in the order they were emitted — the weights for
  // apportioning anything else booked against that bill.
  const portionsOf = new Map<string, ExplodedBill[]>();
  for (const p of exploded) {
    const list = portionsOf.get(p.sourceBillId);
    if (list) list.push(p);
    else portionsOf.set(p.sourceBillId, [p]);
  }

  const splitAcrossSites = <T extends { billId: string; amountCents: number }>(
    row: T,
    label: (portion: ExplodedBill) => Partial<T>
  ): (T & { billId: string })[] => {
    const ps = portionsOf.get(row.billId) ?? [];
    if (ps.length <= 1) return [{ ...row, billId: ps[0]?.id ?? row.billId }];
    const parts = apportionCents(row.amountCents, ps.map((p) => p.subtotalCents));
    return ps.map((p, i) => ({ ...row, ...label(p), billId: p.id, amountCents: parts[i] }));
  };

  const credits = creditRows.flatMap((c) =>
    splitAcrossSites(
      { billId: c.billId, number: c.number, reason: c.reason, amountCents: c.amountCents, status: c.status },
      (p) => ({ reason: `${c.reason} — ${p.projectName ?? "unassigned"} share` })
    )
  );
  const payments = paymentRows.flatMap((p0) =>
    splitAcrossSites(
      { billId: p0.billId, amountCents: p0.amountCents, paidDate: p0.paidDate, method: p0.method, reference: p0.reference },
      (p) => ({ reference: p0.reference ? `${p0.reference} (${p.projectName ?? "unassigned"})` : p0.reference })
    )
  );

  // Only now narrow to one site, and drop the credits and payments that went
  // with the portions being removed.
  const bills = siteCode ? exploded.filter((b) => b.projectCode === siteCode) : exploded;
  const keep = new Set(bills.map((b) => b.id));
  const shown = siteCode ? { credits: credits.filter((c) => keep.has(c.billId)), payments: payments.filter((p) => keep.has(p.billId)) } : { credits, payments };

  const statements = buildSiteStatements(
    bills.map((b) => ({
      billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode,
      assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents,
    })),
    shown.credits,
    shown.payments
  );

  const shownSources = new Set(bills.map((b) => b.sourceBillId));
  return {
    bills,
    statements,
    stmtTotals: totalStatement(statements),
    sourceBillCount: shownSources.size,
    splitBillCount: new Set(bills.filter((b) => b.isSitePortion).map((b) => b.sourceBillId)).size,
  };
}
