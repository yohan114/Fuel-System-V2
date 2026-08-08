import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Consolidated billing PDF for Avissawella (AWIS), June 2026 (issued).
async function main() {
  const Y = 2026, M = 6, periodKey = "2026-06";
  const bills = await prisma.bill.findMany({ where: { projectCode: "AWIS", year: Y, month: M }, orderBy: [{ grandTotalCents: "desc" }] });
  if (!bills.length) throw new Error("no AWIS June bills");
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
  const out = path.join(dir, `consolidated_Avissawella_AWIS_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  console.log(`AWIS June: ${bills.length} vehicles, Rs ${(grand / 100).toLocaleString()} -> ${out}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
