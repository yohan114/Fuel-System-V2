/**
 * Mark a code as a site's own consumption rather than hire plant.
 *
 * Dry-run by default; pass --apply to commit. Idempotent.
 *
 *   node scripts/mark-site-fuel-code.cjs
 *   node scripts/mark-site-fuel-code.cjs --apply
 *
 * GE-117 is the CEP-03 E Package site generator — 264 fuel issues a month, nine
 * a day, which is a site topping up its own set, not a machine anyone hires by
 * the hour. It sat in the fleet as an ordinary 55 kVA generator with no rate
 * card, and the billing engine's rule for that is `no-rate`: no bill at all. So
 * 13,278 L of diesel E&C physically pumped was charged to nobody —
 * Rs 1,535,248 in May and Rs 1,462,890 in June.
 *
 * billFuelOnly is the flag the system already has for exactly this shape: bill
 * the issued fuel, charge no rental, and stop treating a missing rate card as
 * an oversight. It was built for privately-owned vehicles E&C fuels but does not
 * rent; a site's own generator is the same arrangement seen from the other side.
 *
 * The code is left as GE-117 rather than renamed into the SITE- family. The
 * site's own fuel sheets say GE-117, and a rename would have the next import
 * create the asset over again under the old name.
 */
const Database = require("better-sqlite3");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const CODES = [
  {
    code: "GE-117",
    typeLabel: "Site generator — fuel booked to the site, no rental",
    why: "CEP-03 E Package site generator, 55 kVA",
  },
];

db.exec("BEGIN");
console.log(`\n════ SITE FUEL CODES  (${APPLY ? "APPLY" : "DRY-RUN"}) ════\n`);

for (const c of CODES) {
  const a = db.prepare("SELECT id, code, typeLabel, billFuelOnly, status FROM Asset WHERE code = ?").get(c.code);
  if (!a) { console.log(`  ${c.code}  NOT FOUND`); continue; }

  const rate = db.prepare("SELECT id FROM RentalRate WHERE assetId = ?").get(a.id);
  if (rate) {
    // A rate card on a fuel-only code prices nothing — computeTotals zeroes the
    // rental — but it would sit there implying the code is hireable.
    console.log(`  ${c.code}  WARNING: carries a rate card; leaving it, but it can never be charged.`);
  }

  db.prepare("UPDATE Asset SET billFuelOnly = 1, typeLabel = @typeLabel, updatedAt = CURRENT_TIMESTAMP WHERE id = @id")
    .run({ typeLabel: c.typeLabel, id: a.id });

  console.log(`  ${c.code}  ${c.why}`);
  console.log(`          billFuelOnly ${a.billFuelOnly} → 1`);
  console.log(`          typeLabel    ${a.typeLabel === null ? "(none)" : a.typeLabel} → ${c.typeLabel}`);

  // What the change is worth, month by month, so an apply is a known quantity.
  const months = db.prepare(`
    SELECT strftime('%Y-%m', datetime(f.issueDate, '+5 hours', '+30 minutes')) mo,
           COUNT(*) n, ROUND(SUM(f.litres)) litres, SUM(f.totalCost) cost,
           (SELECT COUNT(*) FROM Bill b WHERE b.assetId = f.assetId
              AND b.periodKey = strftime('%Y-%m', datetime(f.issueDate, '+5 hours', '+30 minutes'))) billed
    FROM FuelIssue f WHERE f.assetId = ? AND f.voided = 0
    GROUP BY mo ORDER BY mo`).all(a.id);

  console.log(`\n          fuel that has been going uncharged:`);
  for (const m of months) {
    console.log(
      `            ${m.mo}  ${String(m.n).padStart(4)} issues  ${String(m.litres).padStart(6)} L  ` +
      `Rs ${Math.round(m.cost / 100).toLocaleString("en-LK").padStart(11)}   ${m.billed ? "billed" : "NO BILL"}`,
    );
  }
  console.log(`\n          regenerate the affected months to raise the fuel-only bills.`);
}

if (APPLY) { db.exec("COMMIT"); console.log("\n  ✓ applied.\n"); }
else { db.exec("ROLLBACK"); console.log("\n  (dry-run) nothing written — re-run with --apply.\n"); }
db.close();
