import Database from "better-sqlite3";
import path from "path";

// Merge duplicate vehicles that were saved under a registration plate into their
// canonical E&C fleet-number asset (same pattern as ZB-1980 → LB-21). Each E&C
// asset already carries the plate in its regNo, confirming the pairing. The
// plate assets' non-Galagedara history (e.g. Badalgama issues, filters) is moved
// to the E&C asset with a date|litres|source dedupe; their Galagedara rows are
// dropped (import_galagedara re-creates them under the E&C code afterwards) and
// the plate asset is removed.
//
// Dry-run by default; --apply writes.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// reg plate → E&C fleet number (DT-56, not DT-51: the asset whose regNo is
// LO-7181 is DT-56; DT-51's plate is LO-5981).
const MERGES: [string, string][] = [
  ["59-5421", "DC-08"],
  ["PJ-6376", "HCC-09"],
  ["LO-7181", "DT-56"],
  ["PH-9072", "DC-32"],
  ["LA-1359", "DB-05"],
  ["DAH-2491", "SC-14"],
];
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";

const galTank = (db.prepare("SELECT id FROM BulkTank WHERE name='CEP-03F Galagedara'").get() as any)?.id;
const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

db.exec("BEGIN");
db.pragma("defer_foreign_keys = ON");
try {
  const now = new Date().toISOString();
  for (const [reg, ec] of MERGES) {
    const r = db.prepare("SELECT id FROM Asset WHERE code=?").get(reg) as any;
    const e = db.prepare("SELECT id, regNo FROM Asset WHERE code=?").get(ec) as any;
    if (!r || !e) { console.log(`  skip ${reg}→${ec}: ${!r ? reg : ec} not found`); continue; }

    // 1. Fuel issues: drop the Galagedara ones (re-created under EC by the
    //    importer), move the rest, skipping any date|litres|source already on EC.
    const ecKeys = new Set((db.prepare("SELECT substr(issueDate,1,10) d, litres l, source s FROM FuelIssue WHERE assetId=?").all(e.id) as any[])
      .map((x) => `${x.d}|${x.l}|${x.s}`));
    for (const fi of db.prepare("SELECT id, substr(issueDate,1,10) d, litres l, source s, bulkTankId t FROM FuelIssue WHERE assetId=?").all(r.id) as any[]) {
      if (fi.t === galTank) { if (APPLY) db.prepare("DELETE FROM FuelIssue WHERE id=?").run(fi.id); bump("gala-issues-dropped"); continue; }
      const key = `${fi.d}|${fi.l}|${fi.s}`;
      if (ecKeys.has(key)) { if (APPLY) db.prepare("DELETE FROM FuelIssue WHERE id=?").run(fi.id); bump("dup-issues-skipped"); }
      else { if (APPLY) db.prepare("UPDATE FuelIssue SET assetId=? WHERE id=?").run(e.id, fi.id); ecKeys.add(key); bump("issues-moved"); }
    }

    // 2. AssetFilter: move, skipping filters the EC asset already lists.
    const ecFilters = new Set((db.prepare("SELECT filterId FROM AssetFilter WHERE assetId=?").all(e.id) as any[]).map((x) => x.filterId));
    for (const af of db.prepare("SELECT id, filterId FROM AssetFilter WHERE assetId=?").all(r.id) as any[]) {
      if (ecFilters.has(af.filterId)) { if (APPLY) db.prepare("DELETE FROM AssetFilter WHERE id=?").run(af.id); }
      else { if (APPLY) db.prepare("UPDATE AssetFilter SET assetId=? WHERE id=?").run(e.id, af.id); bump("filters-moved"); }
    }

    // 3. Assignments: drop the plate asset's (Galagedara) postings; the importer
    //    re-creates the EC posting with the correct first-fuel dates.
    if (APPLY) db.prepare("DELETE FROM AssetAssignment WHERE assetId=?").run(r.id);

    // 4. Stamp the plate onto the EC asset (already set, but be sure) and delete
    //    the duplicate.
    if (APPLY) {
      db.prepare("UPDATE Asset SET regNo=COALESCE(regNo, ?), updatedAt=? WHERE id=?").run(reg, now, e.id);
      db.prepare("DELETE FROM Asset WHERE id=?").run(r.id);
      db.prepare("INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?)")
        .run(ADMIN, "DELETE", "Asset", e.id, `Merged duplicate ${reg} (registration) into E&C asset ${ec}`, now);
    }
    bump("merged");
    console.log(`  ${reg} → ${ec}`);
  }

  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (err) { db.exec("ROLLBACK"); throw err; }

console.log(`\n=== MERGE REG DUPLICATES ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`);
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
