import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Export the LOCKED sites' final (ISSUED) June 2026 bills in the app's
// CONSOLIDATED BILLING format (the by-site layout with Mode/Actual/Billed columns
// + statement of account). One PDF per site + one combined. Read-only.

const Y = 2026, M = 6, periodKey = "2026-06";
const SITES: [string, string][] = [
  ["BATTI-02", "ICDP_Batti_Lot-02"], ["CEP-03F", "Galagedara"], ["AMB", "Ambanpola"],
  ["KARA", "Karaitivu"], ["PALO", "Pallam_Oya"], ["CEP-03E", "CEP-03_E"], ["MUTUR", "Mutur"],
];
const CODES = SITES.map((s) => s[0]);
const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function buildStatements(bills: any[]) {
  const billIds = bills.map((b) => b.id);
  const [creditRows, paymentRows] = await Promise.all([
    prisma.creditNote.findMany({ where: { billId: { in: billIds } } }),
    prisma.payment.findMany({ where: { billId: { in: billIds } } }),
  ]);
  const statements = buildSiteStatements(
    bills.map((b) => ({ billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode, assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents })),
    creditRows.map((c) => ({ billId: c.billId, number: c.number, reason: c.reason, amountCents: c.amountCents, status: c.status })),
    paymentRows.map((p) => ({ billId: p.billId, amountCents: p.amountCents, paidDate: p.paidDate, method: p.method, reference: p.reference })),
  );
  return { statements, stmtTotals: totalStatement(statements) };
}

async function main() {
  const base = path.join(process.cwd(), "billing_exports", "locked_June2026_consolidated");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });

  // Per-site consolidated PDFs
  for (const [code, fname] of SITES) {
    const bills = await prisma.bill.findMany({
      where: { projectCode: code, year: Y, month: M, status: { not: "DRAFT" } },
      orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
    });
    if (!bills.length) continue;
    const { statements, stmtTotals } = await buildStatements(bills);
    const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
    fs.writeFileSync(path.join(base, `consolidated_${fname}_${code}_${periodKey}.pdf`), buf);
    console.log(`${code.padEnd(9)} ${bills.length} vehicles  Rs ${(bills.reduce((s, b) => s + b.grandTotalCents, 0) / 100).toLocaleString()}`);
  }

  // Combined: all locked sites in one document
  const allBills = await prisma.bill.findMany({
    where: { projectCode: { in: CODES }, year: Y, month: M, status: { not: "DRAFT" } },
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });
  const { statements, stmtTotals } = await buildStatements(allBills);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={allBills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(path.join(base, `consolidated_ALL_LOCKED_SITES_${periodKey}.pdf`), buf);
  console.log(`\nCombined: ${allBills.length} vehicles  Rs ${(allBills.reduce((s, b) => s + b.grandTotalCents, 0) / 100).toLocaleString()}`);
  console.log(`Saved under ${base}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
