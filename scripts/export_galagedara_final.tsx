import { prisma } from "../src/lib/db";
import { ConsolidatedDocument, explodeBillsBySite } from "../src/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Final Galagedara (CEP-03F) June PDF EXCLUDING the D4D backhoes (D4D-01/02/03),
// which the client bills separately. 8 vehicles.
const EXCLUDE = new Set(["D4D-01", "D4D-02", "D4D-03"]);
async function main() {
  const Y = 2026, M = 6, periodKey = "2026-06";
  const liRows = await prisma.billLineItem.findMany({ where: { projectName: { contains: "Galagedara" }, bill: { year: Y, month: M } }, select: { billId: true } });
  const ids = [...new Set(liRows.map((r) => r.billId))];
  const bills = await prisma.bill.findMany({ where: { id: { in: ids } }, include: { lineItems: true } });
  const projs = await prisma.project.findMany({ select: { id: true, code: true } });
  const codeById = new Map(projs.map((p) => [p.id, p.code] as [string, string]));
  const exploded = explodeBillsBySite(bills as any[], codeById)
    .filter((b: any) => ((b.projectName || "").includes("Galagedara") || b.projectCode === "CEP-03F") && !EXCLUDE.has(b.assetCode))
    .sort((a: any, b: any) => b.grandTotalCents - a.grandTotalCents);

  const statements = buildSiteStatements(
    exploded.map((b: any) => ({ billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode, assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents })),
    [], [],
  );
  const stmtTotals = totalStatement(statements);
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dir = path.join(process.cwd(), "billing_exports");
  const out = path.join(dir, `consolidated_Galagedara_CEP-03F_FINAL_${periodKey}.pdf`);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={exploded} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(out, buf);
  const grand = exploded.reduce((s: number, b: any) => s + b.grandTotalCents, 0);
  console.log(`Galagedara FINAL (no D4D): ${exploded.length} vehicles, Rs ${(grand / 100).toLocaleString(undefined,{minimumFractionDigits:2})} -> ${out}`);
  for (const b of exploded) console.log(`   ${b.assetCode.padEnd(9)} Rs ${(b.grandTotalCents/100).toLocaleString(undefined,{minimumFractionDigits:2})}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
