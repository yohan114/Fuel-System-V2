import { prisma } from "../src/lib/db";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { explodeBillsBySite } from "../src/lib/billing/site-explode";
import { buildSiteStatements, totalStatement } from "../src/lib/billing/statement";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Export the LOCKED sites' final (ISSUED) June 2026 bills in the app's
// CONSOLIDATED BILLING format (the by-site layout with Mode/Actual/Billed columns
// + statement of account). Grouped BY LINE-ITEM SITE, so a multi-site vehicle
// (e.g. MG-07) appears under every site it worked at with that site's portion.
// One PDF per site + one combined. Read-only.

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

function sortForDoc(list: any[]) {
  return [...list].sort((a, b) => (a.projectName || "").localeCompare(b.projectName || "") || b.grandTotalCents - a.grandTotalCents);
}

async function main() {
  const base = path.join(process.cwd(), "billing_exports", "locked_June2026_consolidated");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });

  const projects = await prisma.project.findMany({ select: { id: true, code: true } });
  const codeById = new Map(projects.map((p) => [p.id, p.code]));

  // All locked bills WITH line items, exploded so each site carries its own portion.
  const allBills = await prisma.bill.findMany({
    where: { projectCode: { in: CODES }, year: Y, month: M, status: { not: "DRAFT" } },
    include: { lineItems: true },
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });
  const exploded = explodeBillsBySite(allBills, codeById);

  // Per-site consolidated PDFs — every portion attributed to that site (by line item)
  for (const [code, fname] of SITES) {
    const rows = sortForDoc(exploded.filter((b) => b.projectCode === code));
    if (!rows.length) continue;
    const { statements, stmtTotals } = await buildStatements(rows);
    const buf = await renderToBuffer(<ConsolidatedDocument bills={rows} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
    fs.writeFileSync(path.join(base, `consolidated_${fname}_${code}_${periodKey}.pdf`), buf);
    console.log(`${code.padEnd(9)} ${rows.length} rows  Rs ${(rows.reduce((s, b) => s + b.grandTotalCents, 0) / 100).toLocaleString()}`);
  }

  // Combined: all locked sites in one document (portions at any non-locked site — e.g. Lot-04
  // fuel drawn by a locked vehicle — are excluded so the report stays "locked sites only").
  const combined = sortForDoc(exploded.filter((b) => CODES.includes(b.projectCode)));
  const { statements, stmtTotals } = await buildStatements(combined);
  const buf = await renderToBuffer(<ConsolidatedDocument bills={combined} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />);
  fs.writeFileSync(path.join(base, `consolidated_ALL_LOCKED_SITES_${periodKey}.pdf`), buf);
  const cg = combined.reduce((s, b) => s + b.grandTotalCents, 0);
  const excluded = exploded.filter((b) => !CODES.includes(b.projectCode));
  console.log(`\nCombined (locked-site portions only): ${combined.length} rows  Rs ${(cg / 100).toLocaleString()}`);
  if (excluded.length) console.log(`Excluded ${excluded.length} portion(s) at non-locked sites (Rs ${(excluded.reduce((s, b) => s + b.grandTotalCents, 0) / 100).toLocaleString()}) — locked vehicles' fuel at e.g. Lot-04.`);
  console.log(`Saved under ${base}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
