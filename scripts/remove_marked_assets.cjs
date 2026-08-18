/**
 * Removes the asset records marked "Y" in a fleet_cleanup_review.xlsx.
 * Deletes each marked asset and its dependent rows across every assetId FK
 * table. HALTS on any asset that carries fuel issues or bills (never silently
 * drops billed history). Dry-run by default; pass --apply to commit.
 *
 *   node scripts/remove_marked_assets.cjs <review.xlsx>            # dry-run
 *   node scripts/remove_marked_assets.cjs <review.xlsx> --apply    # commit
 */
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const path = require("path");
const APPLY = process.argv.includes("--apply");
const SRC = process.argv.find((a) => a.endsWith(".xlsx"));
if (!SRC) { console.error("Pass the review .xlsx path."); process.exit(1); }

const cell = (row, c) => {
  let v = row.getCell(c).value;
  if (v && typeof v === "object") { if (v.result !== undefined) v = v.result; else if (v.text !== undefined) v = v.text; else if (v.richText) v = v.richText.map((t) => t.text).join(""); else v = ""; }
  return v == null ? "" : String(v).trim();
};

// assetId FK tables (all that reference Asset.id).
const DEP_TABLES = [
  "FuelRequest", "FuelIssue", "MeterReading", "DailyCondition", "AssetAssignment",
  "RentalRate", "Bill", "ServiceRecord", "ServiceInterval", "AssetFilter", "VehicleAllocation",
];

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const ws = wb.worksheets[0];
  const codes = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const rm = cell(ws.getRow(r), 1), code = cell(ws.getRow(r), 2);
    if (code && /^(y|yes|x|1|remove)$/i.test(rm)) codes.push(code);
  }

  const db = new Database(path.join(process.cwd(), "data", "app.db"));
  const cnt = (t, id) => { try { return db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE assetId=?`).get(id).n; } catch { return 0; } };

  console.log(`\n════ REMOVE MARKED ASSETS  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
  console.log(`Marked in file: ${codes.length}\n`);

  const plan = [];
  let blocked = 0, notFound = 0;
  for (const code of codes) {
    const a = db.prepare("SELECT id, code, regNo FROM Asset WHERE code=?").get(code);
    if (!a) { console.log(`  ✗ NOT FOUND: ${code}`); notFound++; continue; }
    const deps = {};
    for (const t of DEP_TABLES) deps[t] = cnt(t, a.id);
    // Safety: never remove an asset that carries fuel or bills.
    if (deps.FuelIssue > 0 || deps.Bill > 0) {
      console.log(`  ⚠ BLOCKED ${code}: has FuelIssue=${deps.FuelIssue}, Bill=${deps.Bill} — skipped (real history).`);
      blocked++; continue;
    }
    const depStr = DEP_TABLES.filter((t) => deps[t] > 0).map((t) => `${t}=${deps[t]}`).join(", ") || "no dependents";
    console.log(`  • ${code.padEnd(26)} → delete asset + [${depStr}]`);
    plan.push({ id: a.id, code });
  }

  console.log(`\nTo delete: ${plan.length} assets  |  blocked (has fuel/bills): ${blocked}  |  not found: ${notFound}`);

  db.exec("BEGIN");
  for (const p of plan) {
    for (const t of DEP_TABLES) { try { db.prepare(`DELETE FROM "${t}" WHERE assetId=?`).run(p.id); } catch {} }
    db.prepare("DELETE FROM Asset WHERE id=?").run(p.id);
  }
  const remaining = db.prepare("SELECT COUNT(*) n FROM Asset").get().n;
  if (APPLY) { db.exec("COMMIT"); console.log(`\n✓ APPLIED. Removed ${plan.length}. Assets now: ${remaining}.`); }
  else { db.exec("ROLLBACK"); console.log(`\n(DRY-RUN) nothing written. Re-run with --apply to remove.`); }
  db.close();
})();
