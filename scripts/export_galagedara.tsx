import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { explodeBillsBySite } from "../src/lib/billing/site-explode";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Consolidated Galagedara (CEP-03F) June PDF — exploded per-segment so the
// vehicles whose invoice is headed at another site (MG-07 @ CEP-03E) still show
// their Galagedara portion. 11 vehicles, total Rs 3,535,592.28.
async function main() {
  const Y = 2026, M = 6, periodKey = "2026-06";
  const liRows = await prisma.billLineItem.findMany({
    where: { projectName: { contains: "Galagedara" }, bill: { year: Y, month: M } },
    select: { billId: true },
  });
  const ids = [...new Set(liRows.map((r) => r.billId))];
  const bills = await prisma.bill.findMany({ where: { id: { in: ids } }, include: { lineItems: true } });
  const projs = await prisma.project.findMany({ select: { id: true, code: true } });
  const codeById = new Map(projs.map((p) => [p.id, p.code] as [string, string]));

  const exploded = explodeBillsBySite(bills, codeById)
    .filter((b: any) => (b.projectName || "").includes("Galagedara") || b.projectCode === "CEP-03F")
    .sort((a: any, b: any) => b.grandTotalCents - a.grandTotalCents);

  const statements = buildSiteStatements(
    exploded.map((b: any) => ({ billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode, assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents })),
    [], [],
  );
  const stmtTotals = totalStatement(statements);
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dir = path.join(process.cwd(), "billing_exports");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `consolidated_Galagedara_CEP-03F_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={exploded} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = exploded.reduce((s: number, b: any) => s + b.grandTotalCents, 0);
  console.log(`Galagedara: ${exploded.length} vehicles, Rs ${(grand / 100).toLocaleString(undefined,{minimumFractionDigits:2})} -> ${out}`);
  for (const b of exploded) console.log(`   ${b.assetCode.padEnd(9)} ${(b.projectCode||'').padEnd(8)} Rs ${(b.grandTotalCents/100).toLocaleString(undefined,{minimumFractionDigits:2})}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
