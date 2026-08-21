/**
 * Prove the site split moves money to the right sites and loses none of it.
 *
 * Reads the real bills for a month, applies the same explode the consolidated
 * reports now use, and prints what each site was charged BEFORE (grouped by the
 * bill's header site) and AFTER (grouped by the site each line item names).
 *
 *   npx tsx scripts/verify-site-split-distribution.ts 2026 7
 */
import Database from "better-sqlite3";
import { explodeBillsBySite } from "../src/lib/billing/site-explode";

const year = parseInt(process.argv[2] || "2026", 10);
const month = parseInt(process.argv[3] || "7", 10);

const db = new Database(process.env.FUEL_DB || "data/app.db", { readonly: true });
const rs = (c: number) => (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (v: unknown, n: number) => String(v ?? "").padEnd(n);
const padL = (v: unknown, n: number) => String(v ?? "").padStart(n);

const bills: any[] = db
  .prepare(`SELECT id, assetCode, projectId, projectName, projectCode,
                   rentalAmountCents, fuelCostCents, fuelLitres, billableUnits,
                   subtotalCents, ssclCents, vatCents, grandTotalCents
            FROM Bill WHERE year = ? AND month = ?`)
  .all(year, month);

const liStmt = db.prepare(
  `SELECT kind, description, quantity, amountCents, projectId, projectName FROM BillLineItem WHERE billId = ?`
);
for (const b of bills) b.lineItems = liStmt.all(b.id);

const codeById = new Map<string, string>(
  (db.prepare("SELECT id, code FROM Project").all() as any[]).map((p) => [p.id, p.code])
);

const portions = explodeBillsBySite(bills, codeById);

const group = (list: any[]) => {
  const m = new Map<string, { name: string; n: number; grand: number }>();
  for (const b of list) {
    const k = b.projectId || "__none__";
    if (!m.has(k)) m.set(k, { name: b.projectName || "Unassigned", n: 0, grand: 0 });
    const g = m.get(k)!;
    g.n++;
    g.grand += b.grandTotalCents;
  }
  return m;
};

const before = group(bills);
const after = group(portions);
const keys = [...new Set([...before.keys(), ...after.keys()])];

const rows = keys
  .map((k) => {
    const b = before.get(k), a = after.get(k);
    return {
      name: a?.name || b?.name || "Unassigned",
      wasN: b?.n ?? 0, nowN: a?.n ?? 0,
      was: b?.grand ?? 0, now: a?.grand ?? 0,
      delta: (a?.grand ?? 0) - (b?.grand ?? 0),
    };
  })
  .filter((r) => r.delta !== 0)
  .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const totBefore = sum(bills.map((b) => b.grandTotalCents));
const totAfter = sum(portions.map((b) => b.grandTotalCents));
const split = new Set(portions.filter((p) => p.isSitePortion).map((p) => p.sourceBillId));

console.log(`\n════ SITE SPLIT DISTRIBUTION — ${year}-${String(month).padStart(2, "0")} ════`);
console.log(`  bills                       ${bills.length}`);
console.log(`  of which split across sites ${split.size}`);
console.log(`  site-wise rows produced     ${portions.length}`);
console.log(`  sites charged               ${before.size} -> ${after.size}`);

console.log(`\n── WHERE THE MONEY MOVED (grand total, incl. tax) ──`);
console.log(`  ${pad("Site", 30)} ${padL("was", 16)} ${padL("now", 16)} ${padL("change", 16)}  vehicles`);
for (const r of rows) {
  console.log(
    `  ${pad(r.name.slice(0, 29), 30)} ${padL(rs(r.was), 16)} ${padL(rs(r.now), 16)} ` +
    `${padL((r.delta > 0 ? "+" : "") + rs(r.delta), 16)}  ${r.wasN} -> ${r.nowN}`
  );
}
if (rows.length === 0) console.log("  (no site changed — no bill in this month spans more than one site)");

console.log(`\n── RECONCILIATION ──`);
console.log(`  month total before          ${padL(rs(totBefore), 18)}`);
console.log(`  month total after           ${padL(rs(totAfter), 18)}`);
console.log(`  difference                  ${padL(rs(totAfter - totBefore), 18)}   (must be 0.00)`);
const gained = sum(rows.filter((r) => r.delta > 0).map((r) => r.delta));
console.log(`  moved between sites         ${padL(rs(gained), 18)}`);

// Every split bill must still add back to itself.
let broken = 0;
const bySource = new Map<string, any[]>();
for (const p of portions) {
  const l = bySource.get(p.sourceBillId);
  if (l) l.push(p); else bySource.set(p.sourceBillId, [p]);
}
for (const b of bills) {
  const ps = bySource.get(b.id) ?? [];
  if (sum(ps.map((p) => p.grandTotalCents)) !== b.grandTotalCents ||
      sum(ps.map((p) => p.subtotalCents)) !== b.subtotalCents ||
      sum(ps.map((p) => p.ssclCents)) !== b.ssclCents ||
      sum(ps.map((p) => p.vatCents)) !== b.vatCents) {
    broken++;
    console.log(`  !! ${b.assetCode} does not reconcile`);
  }
}
console.log(`  bills that fail to reconcile ${padL(broken, 17)}   (must be 0)`);

if (totAfter !== totBefore || broken > 0) {
  console.log(`\n✗ FAILED — the split changed the month's value.`);
  process.exit(1);
}
console.log(`\n✓ Every rupee stayed in the month and every bill still adds back to itself.`);
db.close();
