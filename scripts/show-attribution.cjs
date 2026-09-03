// Which rule places each fuel issue on a site, and what escapes all of them.
//
//     node scripts/show-attribution.cjs            # current month
//     node scripts/show-attribution.cjs 2026 8
//
// Mirrors attributeIssue() in src/lib/reports/monthly-site-fuel.ts:
//   posted -> tank -> current -> unassigned.
// Written because "this fuel bills to nobody" is easy to claim from a query
// that only joins AssetAssignment, and wrong: an issue with no posting still
// lands on the site that owns the pump it came from.

const Database = require("better-sqlite3");
const fs = require("node:fs");

const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
if (!fs.existsSync(DB_PATH)) { console.error(`\nno database at ${DB_PATH}\n`); process.exit(2); }

const now = new Date();
const year = Number(process.argv[2]) || now.getFullYear();
const month = Number(process.argv[3]) || now.getMonth() + 1;
const bound = (y, m) => new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3600 * 1000).toISOString().replace("Z", "+00:00");
const FROM = bound(year, month);
const TO = bound(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

const db = new Database(DB_PATH, { readonly: true });

const rows = db.prepare(`
  SELECT a.code,
    CASE
      WHEN g.projectId IS NOT NULL THEN 'posted'
      WHEN tp.id IS NOT NULL       THEN 'tank'
      WHEN a.projectId IS NOT NULL THEN 'current'
      ELSE 'unassigned'
    END AS rule,
    COALESCE(gp.code, tp.code, ap.code, '—') AS site,
    COUNT(*) AS n, ROUND(SUM(f.litres), 2) AS L
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  LEFT JOIN AssetAssignment g ON g.assetId = f.assetId AND g.startDate <= f.issueDate
       AND (g.endDate IS NULL OR g.endDate >= f.issueDate)
  LEFT JOIN Project gp ON gp.id = g.projectId
  LEFT JOIN BulkTank t ON t.id = f.bulkTankId
  LEFT JOIN Project tp ON tp.id = t.projectId
  LEFT JOIN Project ap ON ap.id = a.projectId
  WHERE f.voided = 0 AND f.issueDate >= ? AND f.issueDate < ?
  GROUP BY a.code, rule, site`).all(FROM, TO);

const tot = {};
for (const r of rows) {
  tot[r.rule] = tot[r.rule] || { n: 0, L: 0 };
  tot[r.rule].n += r.n;
  tot[r.rule].L += r.L;
}

console.log(`\n=== ${year}-${String(month).padStart(2, "0")} attribution ===\n`);
for (const k of ["posted", "tank", "current", "unassigned"]) {
  const t = tot[k];
  console.log(`  ${k.padEnd(12)}${String(t ? t.n : 0).padStart(5)} issues  ${String(t ? Math.round(t.L * 100) / 100 : 0).padStart(11)} L`);
}

const un = rows.filter((r) => r.rule === "unassigned");
console.log(`\n  billing to NOBODY: ${un.length ? "" : "nothing"}`);
for (const r of un) console.log(`    ${r.code.padEnd(26)}${String(r.n).padStart(3)} issues  ${String(r.L).padStart(11)} L`);

// The "tank" rule is not a failure — it is the recorded fact that the fuel came
// out of that site's pump. Worth seeing, because a machine appearing here a lot
// means its postings are stale, not that its fuel is lost.
const byTank = rows.filter((r) => r.rule === "tank").sort((a, b) => b.L - a.L);
if (byTank.length) {
  console.log(`\n  placed by the PUMP because no posting covered the day (${byTank.reduce((s, r) => s + r.n, 0)} issues):`);
  for (const r of byTank.slice(0, 12)) console.log(`    ${r.code.padEnd(26)}${String(r.n).padStart(3)} issues  ${String(r.L).padStart(11)} L  → ${r.site}`);
  if (byTank.length > 12) console.log(`    ... and ${byTank.length - 12} more machines`);
}
console.log("");
db.close();
