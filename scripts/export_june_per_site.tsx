import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// One consolidated billing PDF per site for June 2026 (issued invoices).
const Y = 2026, M = 6, periodKey = "2026-06";
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function exportSite(projectCode: string, projectName: string) {
  const bills = await prisma.bill.findMany({ where: { projectCode, year: Y, month: M, status: { not: "DRAFT" } }, orderBy: [{ grandTotalCents: "desc" }] });
  if (!bills.length) return null;
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
  const dir = path.join(process.cwd(), "billing_exports", "june_by_site");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `consolidated_${safe(projectName)}_${projectCode}_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  return { code: projectCode, name: projectName, n: bills.length, grand, out };
}

async function main() {
  const sites = await prisma.bill.groupBy({ by: ["projectCode", "projectName"], where: { year: Y, month: M, status: { not: "DRAFT" } }, _sum: { grandTotalCents: true } });
  sites.sort((a, b) => (b._sum.grandTotalCents ?? 0) - (a._sum.grandTotalCents ?? 0));
  console.log(`Generating ${sites.length} per-site June PDFs...\n`);
  for (const s of sites) {
    const r = await exportSite(s.projectCode!, s.projectName ?? s.projectCode!);
    if (r) console.log(`  ${r.name.padEnd(24)} ${String(r.n).padStart(3)}  Rs ${(r.grand / 100).toLocaleString().padStart(16)}  ->  ${path.basename(r.out)}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
