// Prove the Fuel Issue Report answers both site questions correctly.
//
//     npx tsx scripts/check-fuel-issue-report.ts 2026 8 CEP-03F
//
// The page is behind a login, so this runs the same builder the screen, the PDF
// and the Excel all share and checks the two bases against figures derived
// independently. Galagedara for August 2026 is 20,943 L by allocation and
// 21,640 L at its pump; if those two ever come out equal, the basis is being
// ignored somewhere.

import { buildFuelIssueReport } from "../src/lib/reports/fuel-issue-report";
import { prisma } from "../src/lib/db";

const year = Number(process.argv[2]) || 2026;
const month = Number(process.argv[3]) || 8;
const siteCode = process.argv[4] || "CEP-03F";

const L = (n: number) => Math.round(n * 100) / 100;
// Colombo month bounds: a day starts at 18:30Z the evening before.
const bound = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3600 * 1000);

async function main() {
  const from = bound(year, month);
  const to = new Date(bound(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1).getTime() - 1);
  const site = await prisma.project.findFirst({ where: { code: siteCode }, select: { id: true, code: true, name: true } });
  if (!site) throw new Error(`no site ${siteCode}`);

  const byAllocation = await buildFuelIssueReport({ from, to, projectId: site.id });
  const byPump = await buildFuelIssueReport({ from, to, pumpProjectId: site.id });

  console.log(`\n=== ${site.name} (${site.code}) — ${year}-${String(month).padStart(2, "0")} ===\n`);
  console.log(`  by allocation : ${String(byAllocation.totals.issues).padStart(4)} issues  ${String(L(byAllocation.totals.litres)).padStart(10)} L   ${byAllocation.totals.vehicles} vehicles`);
  console.log(`  by its pump   : ${String(byPump.totals.issues).padStart(4)} issues  ${String(L(byPump.totals.litres)).padStart(10)} L   ${byPump.totals.vehicles} vehicles`);
  console.log(`  difference    : ${L(byPump.totals.litres - byAllocation.totals.litres)} L`);

  if (byAllocation.totals.litres === byPump.totals.litres) {
    console.log("\n  BOTH BASES AGREE — suspicious unless this site has no traffic at all.");
  }

  // Cross-check the pump figure against the raw rows, so the report is not just
  // agreeing with itself.
  const raw = await prisma.fuelIssue.aggregate({
    where: { voided: false, issueDate: { gte: from, lte: to }, bulkTank: { projectId: site.id } },
    _sum: { litres: true }, _count: true,
  });
  const ok = Math.abs((raw._sum.litres ?? 0) - byPump.totals.litres) < 0.01 && raw._count === byPump.totals.issues;
  console.log(`\n  raw query on that tank : ${raw._count} issues, ${L(raw._sum.litres ?? 0)} L${ok ? "   MATCHES the pump basis" : "   <-- DOES NOT MATCH"}`);
  if (!ok) process.exitCode = 1;

  // Rows the pump basis includes that allocation does not, and the reverse.
  const allocIds = new Set(byAllocation.rows.map((r) => r.id));
  const pumpIds = new Set(byPump.rows.map((r) => r.id));
  const visiting = byPump.rows.filter((r) => !allocIds.has(r.id));
  const awayFromHome = byAllocation.rows.filter((r) => !pumpIds.has(r.id));
  const sum = (rows: { litres: number }[]) => L(rows.reduce((a, r) => a + r.litres, 0));

  console.log(`\n  visitors fuelling here, billed elsewhere : ${visiting.length} issues, ${sum(visiting)} L`);
  for (const [code, l] of [...visiting.reduce((m, r) => m.set(r.assetCode, (m.get(r.assetCode) ?? 0) + r.litres), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`      ${code.padEnd(11)}${L(l)} L  → ${byPump.rows.find((r) => r.assetCode === code)?.siteCode ?? "?"}`);

  console.log(`\n  our machines fuelling away, billed here  : ${awayFromHome.length} issues, ${sum(awayFromHome)} L`);
  for (const [code, l] of [...awayFromHome.reduce((m, r) => m.set(r.assetCode, (m.get(r.assetCode) ?? 0) + r.litres), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`      ${code.padEnd(11)}${L(l)} L  ← ${byAllocation.rows.find((r) => r.assetCode === code)?.pumpSiteName ?? "?"}`);

  const reconciles = Math.abs(byAllocation.totals.litres - sum(awayFromHome) + sum(visiting) - byPump.totals.litres) < 0.01;
  console.log(`\n  ${L(byAllocation.totals.litres)} - ${sum(awayFromHome)} + ${sum(visiting)} = ${L(byPump.totals.litres)}${reconciles ? "   RECONCILES" : "   <-- DOES NOT RECONCILE"}`);
  if (!reconciles) process.exitCode = 1;
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
