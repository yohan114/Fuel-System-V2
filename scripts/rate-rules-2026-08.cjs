/**
 * Rate assignment, August 2026. Successor to assign_rate_rules.cjs, carrying
 * only the rules agreed since — that script is left alone because re-running it
 * would revive cards deliberately removed after it was written (GE-117 among
 * them) and re-flag fuel-only vehicles that have since been reconsidered.
 *
 * Dry-run by default; pass --apply to commit. Idempotent: re-running restores
 * the same values.
 *
 * Same standing conventions as its predecessor — portable plant bills DRY, and
 * "do not add wet" on plant means only the dry tier is set. Both machines below
 * were drawing diesel with no card at all, so they qualified for a bill under
 * the fuel rule and then priced at nothing:
 *
 *   AC-24   50 L in July across Awissawella and Badalgama
 *   GE-62   190 L in July at Awissawella
 */
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const RULES = [
  {
    code: "AC-24",
    why: "same rate as AC-25 — the compressor rule of July 2026",
    equip: "PORTABLE",
    col: "portDdCents",
    cents: 1_100_000, // Rs 11,000/day dry
    basis: "d",
    category: null,
  },
  {
    code: "GE-62",
    // Catalogue class 603 in scripts/data/rate_cards.json, whose dry tier is
    // 10,000. Its wet tier (18,000) is deliberately not set: plant bills dry.
    why: "Generator · 30–50 kVA (diesel, 3-ph), dry tier",
    equip: "PORTABLE",
    col: "portDdCents",
    cents: 1_000_000, // Rs 10,000/day dry
    basis: "d",
    category: "Generator · 30–50 kVA (diesel, 3-ph)",
  },
];

const rs = (c) => "Rs " + (c / 100).toLocaleString("en-LK");

db.exec("BEGIN");
console.log(`\n════ RATE RULES 2026-08  (${APPLY ? "APPLY" : "DRY-RUN"}) ════\n`);

let created = 0, updated = 0, missing = 0;

for (const r of RULES) {
  const a = db.prepare("SELECT id, code, status FROM Asset WHERE code = ?").get(r.code);
  if (!a) { console.log(`  ${r.code.padEnd(8)} NOT FOUND`); missing++; continue; }

  const before = db.prepare("SELECT * FROM RentalRate WHERE assetId = ?").get(a.id);
  const was = before ? (before[r.col] != null ? rs(before[r.col]) : "unset") : "no card";

  if (before) {
    db.prepare(
      `UPDATE RentalRate SET equipType=@equip, ${r.col}=@cents, defaultBasis=@basis,
       category=@category, sourceLabel='Manual rate rules 2026-08', updatedAt=CURRENT_TIMESTAMP
       WHERE assetId=@assetId`,
    ).run({ equip: r.equip, cents: r.cents, basis: r.basis, category: r.category, assetId: a.id });
    updated++;
  } else {
    db.prepare(
      `INSERT INTO RentalRate (id, assetId, equipType, ${r.col}, defaultBasis, category, sourceLabel, createdAt, updatedAt)
       VALUES (@id, @assetId, @equip, @cents, @basis, @category, 'Manual rate rules 2026-08', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run({ id: crypto.randomUUID(), assetId: a.id, equip: r.equip, cents: r.cents, basis: r.basis, category: r.category });
    created++;
  }

  console.log(`  ${a.code.padEnd(8)} ${r.equip.padEnd(9)} ${r.col.replace("Cents", "").padEnd(10)} ${was} → ${rs(r.cents)} dry`);
  console.log(`  ${" ".repeat(8)} ${r.why}`);
}

// Read the cards back inside the transaction, so the dry-run shows exactly what
// an apply would leave behind rather than what it intended to.
console.log("\n  resulting cards:");
for (const r of RULES) {
  const row = db.prepare(
    "SELECT a.code, r.equipType, r.portDwCents, r.portDdCents, r.defaultBasis, r.category, r.sourceLabel" +
    " FROM Asset a JOIN RentalRate r ON r.assetId = a.id WHERE a.code = ?",
  ).get(r.code);
  if (row) {
    console.log(
      `  ${row.code.padEnd(8)} ${row.equipType}  wet=${row.portDwCents == null ? "—" : rs(row.portDwCents)}` +
      `  dry=${rs(row.portDdCents)}  basis=${row.defaultBasis}  ${row.category ?? ""}`,
    );
  }
}

console.log(`\n  created ${created} · updated ${updated} · not found ${missing}`);
if (APPLY) { db.exec("COMMIT"); console.log("\n  ✓ applied.\n"); }
else { db.exec("ROLLBACK"); console.log("\n  (dry-run) nothing written — re-run with --apply.\n"); }
db.close();
