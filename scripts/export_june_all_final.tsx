import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { explodeBillsBySite } from "../src/lib/billing/site-explode";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Final all-sites June 2026 consolidated PDF, grouped by site, on the exploded
// (per-segment) basis so multi-site vehicles show on each site they served.
async function main() {
  const Y = 2026, M = 6, periodKey = "2026-06";
  const bills = await prisma.bill.findMany({ where: { year: Y, month: M, status: { not: "DRAFT" } }, include: { lineItems: true } });
  const projs = await prisma.project.findMany({ select: { id: true, code: true } });
  const codeById = new Map(projs.map((p) => [p.id, p.code] as [string, string]));
  const exploded = explodeBillsBySite(bills as any[], codeById)
    .sort((a: any, b: any) => (a.projectName || "").localeCompare(b.projectName || "") || b.grandTotalCents - a.grandTotalCents);

  const statements = buildSiteStatements(
    exploded.map((b: any) => ({ billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode, assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents })),
    [], [],
  );
  const stmtTotals = totalStatement(statements);
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dir = path.join(process.cwd(), "billing_exports");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `consolidated_ALL-SITES_June_FINAL_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={exploded} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = exploded.reduce((s: number, b: any) => s + b.grandTotalCents, 0);
  const sites = new Set(exploded.map((b: any) => b.projectName)).size;
  console.log(`June ALL (final, exploded): ${sites} sites, ${bills.length} invoices, Rs ${(grand / 100).toLocaleString(undefined,{minimumFractionDigits:2})} -> ${out} (${(buf.length/1024).toFixed(0)} KB)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
