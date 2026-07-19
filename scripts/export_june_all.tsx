import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Comprehensive consolidated billing PDF for ALL June 2026 issued invoices,
// grouped by site (every project). One document, all 12 sites.
async function main() {
  const Y = 2026, M = 6, periodKey = "2026-06";
  const bills = await prisma.bill.findMany({
    where: { year: Y, month: M, status: { not: "DRAFT" } },
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });
  if (!bills.length) throw new Error("no June bills");
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
  const stmtTotals = totalStatement(statements);
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dir = path.join(process.cwd(), "billing_exports");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `consolidated_ALL-SITES_June_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  const sites = new Set(bills.map((b) => b.projectCode)).size;
  console.log(`June ALL: ${bills.length} invoices, ${sites} sites, Rs ${(grand / 100).toLocaleString()} -> ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
