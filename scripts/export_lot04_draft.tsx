import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Draft consolidated bill for Lot-04 (IRD-04), June 2026 — all bills (DRAFT + the
// 3 already ISSUED), in the app's Consolidated Billing layout. Read-only.

const Y = 2026, M = 6, periodKey = "2026-06";
const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function main() {
  const bills = await prisma.bill.findMany({
    where: { projectCode: "IRD-04", year: Y, month: M },
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });
  if (!bills.length) throw new Error("no IRD-04 bills");
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

  const dir = path.join(process.cwd(), "billing_exports");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `DRAFT_consolidated_Lot-04_IRD-04_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  console.log(`Lot-04 draft bill: ${bills.length} vehicles, Rs ${(grand / 100).toLocaleString()} → ${out}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
