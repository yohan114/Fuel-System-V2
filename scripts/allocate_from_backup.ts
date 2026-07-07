import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Sync each vehicle's project allocation (Asset.projectId) to the live backups,
// then post every CEP-03F Galagedara vehicle (hired ones included) to that site
// as its last/current allocation. The backups carry allocation only as the
// asset→project pointer (no AssetAssignment table), so this updates that pointer.
//
// Sources: the EXTERNAL dump is primary (newest, superset); the DATA dump only
// fills assets EXTERNAL leaves unallocated. FKs match by natural key — asset by
// normalised code, project by code (ING → INGI alias). Missing assets are
// created under Other. Idempotent; dry-run by default, --apply to write.

const APPLY = process.argv.includes("--apply");
const SC = "/tmp/claude-0/-home-user-Fuel-System-V2/ddd640e9-2dc1-5d1a-9875-08410003a7a4/scratchpad";
const EXT = `${SC}/bk_ext/fuel-system/app.db`;
const DAT = `${SC}/bk_data/data/app.db`;

const v2 = new Database(path.join(process.cwd(), "data", "app.db"));
const ext = new Database(EXT, { readonly: true });
const dat = new Database(DAT, { readonly: true });

const norm = (s: string | null | undefined) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const PROJECT_ALIAS: Record<string, string> = { ING: "INGI" };
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const GALAGEDARA_CODE = "CEP-03F";

// backup asset code (raw) → project code (raw), EXTERNAL primary then DATA gap-fill
function allocMap(db: Database.Database): Map<string, { code: string; proj: string }> {
  const proj = new Map((db.prepare("SELECT id, code FROM Project").all() as any[]).map((p) => [p.id, p.code]));
  const m = new Map<string, { code: string; proj: string }>();
  for (const a of db.prepare("SELECT code, projectId FROM Asset WHERE projectId IS NOT NULL").all() as any[]) {
    const pc = proj.get(a.projectId);
    if (pc) m.set(norm(a.code), { code: a.code, proj: pc });
  }
  return m;
}
const extMap = allocMap(ext);
const datMap = allocMap(dat);
const merged = new Map(extMap);
let datFill = 0;
for (const [k, v] of datMap) if (!merged.has(k)) { merged.set(k, v); datFill++; }

// V2 lookups
const v2AssetByNorm = new Map((v2.prepare("SELECT id, code, projectId FROM Asset").all() as any[]).map((a) => [norm(a.code), a]));
const v2ProjByNorm = new Map((v2.prepare("SELECT id, code, name FROM Project").all() as any[]).map((p) => [norm(p.code), p]));
const v2ProjById = new Map((v2.prepare("SELECT id, code FROM Project").all() as any[]).map((p) => [p.id, p.code]));
const otherCat = (v2.prepare("SELECT id FROM Category WHERE code='OTHER'").get() as any)?.id;
const galProj = v2ProjByNorm.get(norm(GALAGEDARA_CODE));
// The 15 machines already assigned to Galagedara (incl. hired D4D).
const galAssets = galProj
  ? (v2.prepare("SELECT DISTINCT assetId FROM AssetAssignment WHERE projectId=?").all(galProj.id) as any[]).map((r) => r.assetId)
  : [];

const insAsset = v2.prepare(`INSERT INTO "Asset" (id,code,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const updProj = v2.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);

const stat = { unchanged: 0, moved: 0, filled: 0, created: 0, projMissing: 0, galSet: 0 };
const moves: string[] = [];
const now = new Date().toISOString();

v2.exec("BEGIN");
v2.pragma("defer_foreign_keys = ON");
try {
  for (const [nk, { code, proj }] of merged) {
    const wantProj = v2ProjByNorm.get(norm(PROJECT_ALIAS[norm(proj)] ?? proj));
    if (!wantProj) { stat.projMissing++; continue; }
    let asset = v2AssetByNorm.get(nk);
    if (!asset) {
      const id = randomUUID();
      if (APPLY) insAsset.run(id, code, "Imported — set type", "ACTIVE", "HOURS", "OWNED", now, now, otherCat, wantProj.id);
      asset = { id, code, projectId: wantProj.id };
      v2AssetByNorm.set(nk, asset);
      stat.created++;
      continue;
    }
    const cur = asset.projectId ? v2ProjById.get(asset.projectId) : null;
    if (asset.projectId === wantProj.id) { stat.unchanged++; continue; }
    if (APPLY) updProj.run(wantProj.id, now, asset.id);
    if (cur) { stat.moved++; if (moves.length < 20) moves.push(`${code}: ${cur} → ${wantProj.code}`); }
    else stat.filled++;
    asset.projectId = wantProj.id;
  }

  // Galagedara last: post every Galagedara vehicle (incl. hires) to CEP-03F.
  if (galProj) {
    for (const assetId of galAssets) {
      const row = v2.prepare("SELECT id, code, projectId FROM Asset WHERE id=?").get(assetId) as any;
      if (!row || row.projectId === galProj.id) continue;
      if (APPLY) updProj.run(galProj.id, now, assetId);
      stat.galSet++;
    }
  }

  if (APPLY) {
    v2.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,summary,createdAt) VALUES (?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN, "UPDATE", "Asset",
        `Allocated vehicles from live backups: ${stat.moved} moved, ${stat.filled} newly allocated, ${stat.created} created, ${stat.galSet} posted to CEP-03F Galagedara`, now);
    v2.exec("COMMIT");
  } else v2.exec("ROLLBACK");
} catch (err) {
  v2.exec("ROLLBACK");
  throw err;
}

console.log(`=== ALLOCATE FROM BACKUP ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
console.log(`  source allocations: ${merged.size} (EXTERNAL ${extMap.size} + DATA gap-fill ${datFill})`);
console.log(`  already correct : ${stat.unchanged}`);
console.log(`  newly allocated : ${stat.filled}  (were unallocated in V2)`);
console.log(`  moved project   : ${stat.moved}   (V2 had a different project)`);
console.log(`  assets created  : ${stat.created} (missing in V2 → Other)`);
console.log(`  Galagedara posts: ${stat.galSet}  (of ${galAssets.length} Galagedara vehicles, incl. hires)`);
console.log(`  project unmatched: ${stat.projMissing}`);
if (moves.length) { console.log("  sample moves:"); for (const m of moves) console.log("   · " + m); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
v2.close(); ext.close(); dat.close();
