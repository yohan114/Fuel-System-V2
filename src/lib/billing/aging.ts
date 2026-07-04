import { prisma } from "../db";

// Accounts-receivable aging. Outstanding = issued/overdue invoice grand totals
// minus any issued credit notes, bucketed by how far past the due date each
// invoice is. Grouped by site for collection follow-up.

export interface SiteAging {
  projectId: string;
  name: string;
  count: number;
  current: number; // not yet due
  d1_30: number;
  d31_60: number;
  d60plus: number;
  totalOutstanding: number;
}

export interface AgingReport {
  sites: SiteAging[];
  totals: { count: number; current: number; d1_30: number; d31_60: number; d60plus: number; totalOutstanding: number };
  asOf: Date;
}

const DAY = 1000 * 60 * 60 * 24;

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d60plus";

// Pure: which bucket an invoice falls in, by days past its due date
// (zero/negative = not yet due).
export function agingBucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  return "d60plus";
}

export async function getAgingReport(opts: { projectId?: string } = {}): Promise<AgingReport> {
  const now = new Date();

  const bills = await prisma.bill.findMany({
    where: { status: { in: ["ISSUED", "OVERDUE"] }, ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    select: { id: true, projectId: true, projectName: true, grandTotalCents: true, dueDate: true },
  });

  // Issued credit notes reduce the outstanding balance per invoice.
  const credits = await prisma.creditNote.findMany({
    where: { status: "ISSUED" },
    select: { billId: true, amountCents: true },
  });
  const creditMap = new Map<string, number>();
  for (const c of credits) creditMap.set(c.billId, (creditMap.get(c.billId) || 0) + c.amountCents);

  const siteMap = new Map<string, SiteAging>();
  const empty = (id: string, name: string): SiteAging => ({ projectId: id, name, count: 0, current: 0, d1_30: 0, d31_60: 0, d60plus: 0, totalOutstanding: 0 });

  for (const b of bills) {
    const outstanding = b.grandTotalCents - (creditMap.get(b.id) || 0);
    if (outstanding <= 0) continue;

    const key = b.projectId || "__unassigned__";
    if (!siteMap.has(key)) siteMap.set(key, empty(key, b.projectName || "Unassigned"));
    const s = siteMap.get(key)!;
    s.count++;
    s.totalOutstanding += outstanding;

    const daysPastDue = b.dueDate ? Math.floor((now.getTime() - new Date(b.dueDate).getTime()) / DAY) : 0;
    s[agingBucketFor(daysPastDue)] += outstanding;
  }

  const sites = [...siteMap.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  const totals = sites.reduce(
    (t, s) => {
      t.count += s.count;
      t.current += s.current;
      t.d1_30 += s.d1_30;
      t.d31_60 += s.d31_60;
      t.d60plus += s.d60plus;
      t.totalOutstanding += s.totalOutstanding;
      return t;
    },
    { count: 0, current: 0, d1_30: 0, d31_60: 0, d60plus: 0, totalOutstanding: 0 }
  );

  return { sites, totals, asOf: now };
}
