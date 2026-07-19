import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Consolidated billing PDF for Ruwanwella (RUWA), March + June 2026 (issued).
async function exportMonth(y: number, m: number, periodKey: string, label: string) {
  const bills = await prisma.bill.findMany({ where: { projectCode: "RUWA", year: y, month: m }, orderBy: [{ grandTotalCents: "desc" }] });
  if (!bills.length) { console.log(`no RUWA ${periodKey} bills`); return; }
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
  const out = path.join(dir, `consolidated_Ruwanwella_RUWA_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  console.log(`${label}: ${bills.length} vehicles, Rs ${(grand / 100).toLocaleString()} → ${out}`);
}

async function main() {
  await exportMonth(2026, 3, "2026-03", "RUWA March");
  await exportMonth(2026, 6, "2026-06", "RUWA June");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
