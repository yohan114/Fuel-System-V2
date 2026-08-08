// Per-site statement of account.
//
// The consolidated billing export lists invoices grouped by site, but a client
// wants a *statement*: what was invoiced this month, what was credited back,
// what has been paid, and therefore what is still outstanding. This module
// buckets invoices, credit notes and payments by site and reconciles them to a
// single closing balance per site:
//
//     outstanding = invoiced − credited − paid
//
// Only ISSUED invoices count as charges (a DRAFT is not yet a real invoice) and
// only ISSUED credit notes reduce the balance (a DRAFT credit is still pending
// approval); both drafts are still listed so nothing is hidden. All arithmetic
// is in LKR cents and pure, so the reconciliation is unit-testable.

export interface StatementBill {
  billId: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  assetCode: string;
  invoiceNumber: string | null;
  status: string; // DRAFT | ISSUED | PAID | OVERDUE
  grandTotalCents: number;
  dueDate?: Date | null;
}

export interface StatementCredit {
  billId: string;
  number: string | null;
  reason: string;
  amountCents: number;
  status: string; // DRAFT | ISSUED
}

export interface StatementPayment {
  billId: string;
  amountCents: number;
  paidDate: Date;
  method: string | null;
  reference: string | null;
}

export interface SiteStatement {
  projectKey: string;
  projectName: string;
  projectCode: string | null;
  invoices: StatementBill[]; // non-draft only
  creditNotes: StatementCredit[]; // all, for display
  payments: StatementPayment[];
  invoicedCents: number; // Σ grand of ISSUED/PAID/OVERDUE invoices
  creditedCents: number; // Σ ISSUED credit notes
  paidCents: number; // Σ payments
  outstandingCents: number; // invoiced − credited − paid
}

const UNASSIGNED = "__unassigned__";

export function buildSiteStatements(
  bills: StatementBill[],
  credits: StatementCredit[],
  payments: StatementPayment[],
): SiteStatement[] {
  const billSite = new Map<string, string>(); // billId → site key
  const stmt = new Map<string, SiteStatement>();

  const keyFor = (projectId: string | null) => projectId || UNASSIGNED;

  const ensure = (key: string, name: string, code: string | null): SiteStatement => {
    let s = stmt.get(key);
    if (!s) {
      s = {
        projectKey: key,
        projectName: name,
        projectCode: code,
        invoices: [],
        creditNotes: [],
        payments: [],
        invoicedCents: 0,
        creditedCents: 0,
        paidCents: 0,
        outstandingCents: 0,
      };
      stmt.set(key, s);
    }
    return s;
  };

  for (const b of bills) {
    const key = keyFor(b.projectId);
    billSite.set(b.billId, key);
    const s = ensure(key, b.projectName || "Unassigned", b.projectCode);
    if (b.status !== "DRAFT") {
      s.invoices.push(b);
      s.invoicedCents += b.grandTotalCents;
    }
  }

  for (const c of credits) {
    const key = billSite.get(c.billId);
    if (!key) continue; // credit against a bill outside this period/scope
    const s = stmt.get(key)!;
    s.creditNotes.push(c);
    if (c.status === "ISSUED") s.creditedCents += c.amountCents;
  }

  for (const p of payments) {
    const key = billSite.get(p.billId);
    if (!key) continue;
    const s = stmt.get(key)!;
    s.payments.push(p);
    s.paidCents += p.amountCents;
  }

  for (const s of stmt.values()) {
    s.outstandingCents = s.invoicedCents - s.creditedCents - s.paidCents;
  }

  // A site that only had draft bills (no real invoices, credits or payments)
  // has nothing to state — drop it.
  return [...stmt.values()]
    .filter((s) => s.invoices.length > 0 || s.creditNotes.length > 0 || s.payments.length > 0)
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export interface StatementTotals {
  invoicedCents: number;
  creditedCents: number;
  paidCents: number;
  outstandingCents: number;
}

// Roll-up across all sites in a statement set.
export function totalStatement(statements: SiteStatement[]): StatementTotals {
  return statements.reduce<StatementTotals>(
    (a, s) => {
      a.invoicedCents += s.invoicedCents;
      a.creditedCents += s.creditedCents;
      a.paidCents += s.paidCents;
      a.outstandingCents += s.outstandingCents;
      return a;
    },
    { invoicedCents: 0, creditedCents: 0, paidCents: 0, outstandingCents: 0 },
  );
}
