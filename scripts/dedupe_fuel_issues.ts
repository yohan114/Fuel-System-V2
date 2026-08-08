import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Remove fuel rows that are the same refuel written into two books.
//
// A site's fuel reaches this system by several routes — a consolidated register
// rolled up at head office, the site's own stock book, a month's photographed
// sheets. Where two of them cover the same period the same refuel lands twice,
// and the site's litres, its cost and its bill are all inflated.
//
// The test is narrow on purpose. A row is a duplicate only when another row with
// the SAME machine, SAME Colombo day and SAME litres exists under a DIFFERENT
// source. Two rows from the SAME source are left alone: the books really do
// record repeat fills, and they say so — the Wadakada register's own control
// findings note "DAB-5905 drew 10 L twice on 02 Aug", and the Lot-02 sheet has a
// 1st and 2nd Fuel Qty column for exactly this. Deleting those would destroy real
// fuel.
//
// Even then, only a source whose rows are duplicated is offered, and the scan
// shows what share of each source is affected — a source 100% duplicated is a
// double-import, a source 5% duplicated is mostly genuine and needs a closer
// look before anything is removed.
//
//   npx tsx scripts/dedupe_fuel_issues.ts                        # scan every source
//   npx tsx scripts/dedupe_fuel_issues.ts --source="Consolidated register (CEP-03)"
//   npx tsx scripts/dedupe_fuel_issues.ts --source="..." --apply

const APPLY = process.argv.includes("--apply");
const SOURCE = process.argv.find((a) => a.startsWith("--source="))?.slice(9);

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function load() {
  return prisma.fuelIssue.findMany({
    where: { voided: false },
    select: { id: true, assetId: true, issueDate: true, litres: true, source: true,
      asset: { select: { code: true } },
      bulkTank: { select: { project: { select: { code: true } } } } },
  });
}
const keyOf = (r: { assetId: string; issueDate: Date; litres: number }) =>
  `${r.assetId}|${dayOf(r.issueDate)}|${r.litres}`;

async function scan() {
  const all = await load();
  const byKey = new Map<string, typeof all>();
  for (const r of all) (byKey.get(keyOf(r)) ?? byKey.set(keyOf(r), []).get(keyOf(r))!).push(r);

  const stat = new Map<string, { rows: number; litres: number; dup: number; dupLitres: number; against: Map<string, number> }>();
  for (const r of all) {
    const s = stat.get(r.source) ?? { rows: 0, litres: 0, dup: 0, dupLitres: 0, against: new Map<string, number>() };
    s.rows++; s.litres += r.litres;
    const others = byKey.get(keyOf(r))!.filter((x) => x.source !== r.source);
    if (others.length) {
      s.dup++; s.dupLitres += r.litres;
      for (const o of new Set(others.map((x) => x.source))) s.against.set(o, (s.against.get(o) || 0) + 1);
    }
    stat.set(r.source, s);
  }

  console.log(`\n=== ${all.length} live fuel rows, by source ===`);
  console.log(`  rows duplicated by ANOTHER source (same machine, day and litres)\n`);
  const rows = [...stat].filter(([, s]) => s.dup > 0).sort((a, b) => b[1].dup - a[1].dup);
  if (!rows.length) { console.log("  none — no source repeats another\n"); return; }
  for (const [src, s] of rows) {
    const pct = Math.round((s.dup / s.rows) * 100);
    console.log(`  ${String(s.dup).padStart(4)} of ${String(s.rows).padStart(5)} rows (${String(pct).padStart(3)}%) · ${Math.round(s.dupLitres).toLocaleString().padStart(7)} L   "${src}"`);
    for (const [o, n] of [...s.against].sort((a, b) => b[1] - a[1])) console.log(`         ${String(n).padStart(4)} against "${o}"`);
    if (pct === 100) console.log(`         EVERY row of this source exists elsewhere — it is a duplicate import`);
  }
  console.log(`\n  To remove one:  npx tsx scripts/dedupe_fuel_issues.ts --source="<name>"\n`);
}

async function prune() {
  console.log(`\n=== remove duplicated rows from "${SOURCE}" (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();
  const all = await load();
  const mine = all.filter((r) => r.source === SOURCE);
  if (!mine.length) throw new Error(`no live rows carry the source "${SOURCE}"`);

  const byKey = new Map<string, typeof all>();
  for (const r of all) (byKey.get(keyOf(r)) ?? byKey.set(keyOf(r), []).get(keyOf(r))!).push(r);

  const doomed: typeof mine = [];
  const kept: typeof mine = [];
  for (const r of mine) {
    const others = byKey.get(keyOf(r))!.filter((x) => x.source !== r.source);
    (others.length ? doomed : kept).push(r);
  }

  console.log(`\n  "${SOURCE}": ${mine.length} rows · ${Math.round(mine.reduce((s, r) => s + r.litres, 0)).toLocaleString()} L`);
  console.log(`  ${doomed.length} duplicated by another source · ${kept.length} unique to this source\n`);
  for (const r of doomed.slice(0, 40)) {
    const twin = byKey.get(keyOf(r))!.filter((x) => x.source !== r.source);
    console.log(`  remove  ${dayOf(r.issueDate)}  ${r.asset.code.padEnd(10)} ${String(r.litres).padStart(4)} L  on ${(r.bulkTank?.project?.code ?? "—").padEnd(11)} — also in ${[...new Set(twin.map((x) => `"${x.source}" on ${x.bulkTank?.project?.code}`))].join(", ")}`);
  }
  if (doomed.length > 40) console.log(`  … and ${doomed.length - 40} more`);
  if (kept.length) {
    console.log(`\n  KEPT — these exist nowhere else, so removing them would lose fuel:`);
    for (const r of kept.slice(0, 20)) console.log(`      ${dayOf(r.issueDate)}  ${r.asset.code.padEnd(10)} ${String(r.litres).padStart(4)} L  on ${r.bulkTank?.project?.code}`);
    if (kept.length > 20) console.log(`      … and ${kept.length - 20} more`);
  }
  console.log(`\n  ${doomed.length} row(s) · ${Math.round(doomed.reduce((s, r) => s + r.litres, 0)).toLocaleString()} L ${APPLY ? "removed" : "would be removed"}`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }
  const ids = doomed.map((r) => r.id);
  // Readings hang off issues by an optional link; deleting the issue alone would
  // leave them pointing at nothing.
  await prisma.meterReading.deleteMany({ where: { linkedIssueId: { in: ids } } });
  await prisma.fuelIssue.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDone.\n`);
}

async function main() {
  if (!SOURCE) { announceDatabase(); return scan(); }
  return prune();
}

main().finally(() => prisma.$disconnect());
