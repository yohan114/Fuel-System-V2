import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// D4D-01/02/03 are JCB backhoe loaders (hired). Reclassify them from the interim
// "Bulldozer" bucket into the Backhoe Loader (LB) category and give them the
// highest rate card in the LB fleet so they bill like a top JCB. Ownership stays
// HIRED. Idempotent; dry-run by default, --apply to write.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const D4D = ["D4D-01", "D4D-02", "D4D-03"];
const DEFAULT_BASIS = "w"; // Wet (rate + fuel). Switch to "d" for dry if the site provides fuel.

// The highest LB rate card (Rs 4,150/hr fully-wet). Pick the LB asset whose
// fully-wet hourly rate is the max, and copy its whole card.
const topLb = db.prepare(`
  SELECT r.* FROM RentalRate r JOIN Asset a ON a.id = r.assetId
  WHERE a.code LIKE 'LB-%' AND r.hrFwCents IS NOT NULL
  ORDER BY r.hrFwCents DESC, r.hrWCents DESC LIMIT 1
`).get() as any;
const lbCat = (db.prepare("SELECT id FROM Category WHERE code='LB'").get() as any)?.id;
const dzCat = (db.prepare("SELECT id FROM Category WHERE code='DZ'").get() as any)?.id;

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

db.exec("BEGIN");
try {
  const now = new Date().toISOString();
  for (const code of D4D) {
    const a = db.prepare("SELECT id FROM Asset WHERE code=?").get(code) as any;
    if (!a) { console.log(`  ${code} missing`); continue; }
    // Reclassify to LB / JCB (keep HIRED, HOURS).
    if (APPLY) db.prepare("UPDATE Asset SET categoryId=?, typeLabel='JCB backhoe loader (hired)', updatedAt=? WHERE id=?").run(lbCat, now, a.id);
    // Upsert the rate card = the top LB card.
    const existing = db.prepare("SELECT id FROM RentalRate WHERE assetId=?").get(a.id) as any;
    const cols = {
      equipType: "FLEET",
      hrFwCents: topLb.hrFwCents, hrWCents: topLb.hrWCents, hrDCents: topLb.hrDCents,
      dyFwCents: topLb.dyFwCents, dyWCents: topLb.dyWCents, dyDCents: topLb.dyDCents,
      fuelConsEcon: topLb.fuelConsEcon, fuelConsTyp: topLb.fuelConsTyp, fuelConsHeavy: topLb.fuelConsHeavy, fuelConsBasis: topLb.fuelConsBasis,
      opRate: topLb.opRate, defaultBasis: DEFAULT_BASIS,
      sourceLabel: `${code} · JCB (hired) · matched to top LB rate`,
    };
    if (APPLY) {
      if (existing) {
        db.prepare(`UPDATE RentalRate SET equipType=@equipType,hrFwCents=@hrFwCents,hrWCents=@hrWCents,hrDCents=@hrDCents,dyFwCents=@dyFwCents,dyWCents=@dyWCents,dyDCents=@dyDCents,fuelConsEcon=@fuelConsEcon,fuelConsTyp=@fuelConsTyp,fuelConsHeavy=@fuelConsHeavy,fuelConsBasis=@fuelConsBasis,opRate=@opRate,defaultBasis=@defaultBasis,sourceLabel=@sourceLabel,updatedAt=@now WHERE id=@id`).run({ ...cols, now, id: existing.id });
      } else {
        db.prepare(`INSERT INTO RentalRate (id,assetId,equipType,hrFwCents,hrWCents,hrDCents,dyFwCents,dyWCents,dyDCents,fuelConsEcon,fuelConsTyp,fuelConsHeavy,fuelConsBasis,opRate,defaultBasis,sourceLabel,createdAt,updatedAt) VALUES (@id,@assetId,@equipType,@hrFwCents,@hrWCents,@hrDCents,@dyFwCents,@dyWCents,@dyDCents,@fuelConsEcon,@fuelConsTyp,@fuelConsHeavy,@fuelConsBasis,@opRate,@defaultBasis,@sourceLabel,@now,@now)`).run({ ...cols, id: randomUUID(), assetId: a.id, now });
      }
    }
    bump("rated");
    console.log(`  ${code} → LB/JCB, rate hr fw/w/d = ${topLb.hrFwCents / 100}/${topLb.hrWCents / 100}/${topLb.hrDCents / 100}, basis ${DEFAULT_BASIS}`);
  }
  // Remove the now-empty interim Bulldozer category.
  if (dzCat) {
    const left = (db.prepare("SELECT COUNT(*) c FROM Asset WHERE categoryId=?").get(dzCat) as any).c;
    if (left === 0) { if (APPLY) db.prepare("DELETE FROM Category WHERE id=?").run(dzCat); bump("dzCatRemoved"); }
  }
  if (APPLY) db.prepare("INSERT INTO AuditLog (id,actorId,action,entity,summary,createdAt) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), ADMIN, "UPDATE", "RentalRate", `Set D4D-01/02/03 to JCB (LB) with the top LB rate card (Rs ${topLb.hrFwCents / 100}/${topLb.hrWCents / 100}/${topLb.hrDCents / 100} per hr fw/w/d)`, now);

  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`\n=== SET D4D JCB RATE ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k} ${v}`);
if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
db.close();
