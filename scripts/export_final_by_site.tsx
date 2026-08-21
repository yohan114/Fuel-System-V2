import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { explodeBillsBySite } from "../src/lib/billing/site-explode";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// One final consolidated PDF per site per billed month, on the EXPLODED
// (per-segment) basis — so multi-site vehicles show their portion on each site
// they served (e.g. MG-07's Galagedara share appears on the Galagedara bill).
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const bills = await prisma.bill.findMany({ where: { status: { not: "DRAFT" } }, include: { lineItems: true } });
  const projs = await prisma.project.findMany({ select: { id: true, code: true, name: true } });
  const codeById = new Map(projs.map((p) => [p.id, p.code] as [string, string]));
  const nameByCode = new Map(projs.map((p) => [p.code, p.name] as [string, string]));
  const exploded = explodeBillsBySite(bills as any[], codeById);

  const groups = new Map<string, any[]>();
  for (const b of exploded) {
    const key = `${b.projectCode}||${b.year}||${b.month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }

  const dir = path.join(process.cwd(), "billing_exports", "final_by_site");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const results: { code: string; y: number; m: number; n: number; grand: number; file: string }[] = [];

  for (const [key, gbills] of groups) {
    const [code, yy, mm] = key.split("||");
    const y = Number(yy), m = Number(mm);
    const periodKey = `${y}-${String(m).padStart(2, "0")}`;
    gbills.sort((a, b) => b.grandTotalCents - a.grandTotalCents);
    const statements = buildSiteStatements(
      gbills.map((b) => ({ billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode, assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents })),
      [], [],
    );
    const stmtTotals = totalStatement(statements);
    const name = nameByCode.get(code) || code;
    const out = path.join(dir, `consolidated_${safe(name)}_${code}_${periodKey}.pdf`);
    const buf = await renderToBuffer(<ConsolidatedDocument bills={gbills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
    fs.writeFileSync(out, buf);
    const grand = gbills.reduce((s, b) => s + b.grandTotalCents, 0);
    results.push({ code, y, m, n: gbills.length, grand, file: path.basename(out) });
  }

  results.sort((a, b) => a.y - b.y || a.m - b.m || b.grand - a.grand);
  let tot = 0;
  for (const r of results) { tot += r.grand; console.log(`  ${r.y}-${String(r.m).padStart(2, "0")} ${r.code.padEnd(9)} ${String(r.n).padStart(3)}  Rs ${(r.grand / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(16)}  ${r.file}`); }
  console.log(`\n${results.length} site PDFs, grand total Rs ${(tot / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
