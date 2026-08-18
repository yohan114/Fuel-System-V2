import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Merge the live production fuel data (the "external" fuelsystem dump) into this
// system: recent fuel issues, plus the new projects and users they need. The
// two systems share fuel-issue and meter-reading ids (common lineage) but
// regenerate asset/user/project ids, so records dedupe by id and foreign keys
// match by natural key — asset by code, user by username, project by code.
//
// Idempotent: a fuel issue / meter reading already present (by id) is skipped,
// as is a user (by username) or project (by code) that already exists.
// Dry-run by default; --apply writes (one deferred-FK transaction).
// --src=<path> overrides the source database.

const APPLY = process.argv.includes("--apply");
const SRC = process.argv.find((a) => a.startsWith("--src="))?.slice(6)
  ?? "/tmp/claude-0/-home-user-Fuel-System-V2/ddd640e9-2dc1-5d1a-9875-08410003a7a4/scratchpad/u_ext/fuel-system/app.db";

const src = new Database(SRC, { readonly: true });
const v2 = new Database(path.join(process.cwd(), "data", "app.db"));

const norm = (s: string | null | undefined) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const VALID_ROLES = new Set(["ADMIN", "ALLOCATOR", "WORKSHOP", "USER"]);
// A source-system project code that is the same physical site as an existing V2
// code under a different spelling.
const PROJECT_ALIAS: Record<string, string> = { ING: "INGI" };

const stats: Record<string, { created: number; matched: number; skipped: number }> = {};
const stat = (t: string) => (stats[t] ??= { created: 0, matched: 0, skipped: 0 });
const notes: string[] = [];

v2.exec("BEGIN");
v2.pragma("defer_foreign_keys = ON");
try {
  const now = new Date().toISOString();
  const admin = v2.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get() as any;

  // ---- 1. Projects -----------------------------------------------------------
  const v2ProjByCode = new Map((v2.prepare("SELECT id, code FROM Project").all() as any[]).map((p) => [p.code.toUpperCase(), p.id]));
  const insProj = v2.prepare(`INSERT INTO "Project" (id,name,code,createdAt,updatedAt) VALUES (?,?,?,?,?)`);
  const srcProjToV2 = new Map<string, string>(); // src project id → v2 project id
  for (const p of src.prepare("SELECT * FROM Project").all() as any[]) {
    const wantCode = (PROJECT_ALIAS[p.code?.toUpperCase()] ?? p.code ?? "").toUpperCase();
    let v2id = v2ProjByCode.get(wantCode);
    if (v2id) { srcProjToV2.set(p.id, v2id); stat("Project").matched++; continue; }
    v2id = randomUUID();
    if (APPLY) insProj.run(v2id, p.name, p.code, now, now);
    v2ProjByCode.set((p.code || "").toUpperCase(), v2id);
    srcProjToV2.set(p.id, v2id);
    stat("Project").created++;
    notes.push(`new project ${p.code} = ${p.name}`);
  }

  // ---- 2. Users --------------------------------------------------------------
  const v2UserByName = new Map((v2.prepare("SELECT id, username FROM User").all() as any[]).map((u) => [u.username, u.id]));
  const insUser = v2.prepare(`INSERT INTO "User" (id,username,email,name,passwordHash,role,active,createdAt,updatedAt,createdById,projectId,bulkTankId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const srcUserToV2 = new Map<string, string>();
  for (const u of src.prepare("SELECT * FROM User").all() as any[]) {
    const existing = v2UserByName.get(u.username);
    if (existing) { srcUserToV2.set(u.id, existing); stat("User").matched++; continue; }
    const role = VALID_ROLES.has(u.role) ? u.role : "USER"; // SITE_PUMP → USER (project-scoped issuer)
    const projectId = u.projectId ? srcProjToV2.get(u.projectId) ?? null : null;
    const id = randomUUID();
    if (APPLY) insUser.run(id, u.username, u.email ?? null, u.name ?? u.username, u.passwordHash, role, u.active ?? 1, u.createdAt ?? now, now, admin?.id ?? null, projectId, null);
    v2UserByName.set(u.username, id);
    srcUserToV2.set(u.id, id);
    stat("User").created++;
    notes.push(`new user ${u.username} (${u.role}${role !== u.role ? ` → ${role}` : ""})`);
  }

  // ---- 3. Assets referenced by new issues but missing from V2 ----------------
  const v2AssetByNorm = new Map((v2.prepare("SELECT id, code FROM Asset").all() as any[]).map((a) => [norm(a.code), a.id]));
  const srcAsset = new Map((src.prepare("SELECT * FROM Asset").all() as any[]).map((a) => [a.id, a]));
  const otherCat = (v2.prepare("SELECT id FROM Category WHERE code='OTHER' OR name LIKE '%Other%' LIMIT 1").get() as any)?.id;
  const srcCatName = new Map((src.prepare("SELECT id, name, code FROM Category").all() as any[]).map((c) => [c.id, c]));
  const v2CatByName = new Map((v2.prepare("SELECT id, name FROM Category").all() as any[]).map((c) => [c.name.toUpperCase(), c.id]));
  const insAsset = v2.prepare(`INSERT INTO "Asset" (id,code,brand,typeLabel,model,regNo,status,meterType,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const v2FiIds = new Set((v2.prepare("SELECT id FROM FuelIssue").all() as any[]).map((r) => r.id));
  const newIssues = (src.prepare("SELECT * FROM FuelIssue").all() as any[]).filter((f) => !v2FiIds.has(f.id));

  const resolveAsset = (srcAssetId: string): string | null => {
    const a = srcAsset.get(srcAssetId);
    if (!a) return null;
    const hit = v2AssetByNorm.get(norm(a.code));
    if (hit) return hit;
    // create it
    const catId = (a.categoryId && v2CatByName.get((srcCatName.get(a.categoryId)?.name || "").toUpperCase())) || otherCat;
    if (!catId) return null;
    const id = randomUUID();
    if (APPLY) insAsset.run(id, a.code, a.brand ?? null, a.typeLabel ?? null, a.model ?? null, a.regNo ?? null, a.status ?? "ACTIVE", a.meterType ?? "HOURS", a.createdAt ?? now, now, catId, a.projectId ? srcProjToV2.get(a.projectId) ?? null : null);
    v2AssetByNorm.set(norm(a.code), id);
    stat("Asset").created++;
    notes.push(`created missing asset ${a.code}`);
    return id;
  };

  // ---- 4. Meter readings linked to / alongside the new issues ----------------
  const v2MrIds = new Set((v2.prepare("SELECT id FROM MeterReading").all() as any[]).map((r) => r.id));
  const insMr = v2.prepare(`INSERT INTO "MeterReading" (id,value,readingType,readingDate,source,createdAt,assetId,recordedById,linkedIssueId) VALUES (?,?,?,?,?,?,?,?,?)`);
  const importedMr = new Set<string>();
  const newIssueIds = new Set(newIssues.map((f) => f.id));
  for (const mr of src.prepare("SELECT * FROM MeterReading").all() as any[]) {
    if (v2MrIds.has(mr.id)) { stat("MeterReading").matched++; continue; }
    // only readings that belong to a new issue or are otherwise new-and-resolvable
    const assetV2 = resolveAsset(mr.assetId);
    if (!assetV2) { stat("MeterReading").skipped++; continue; }
    const recordedBy = srcUserToV2.get(mr.recordedById) ?? admin?.id ?? null;
    if (!recordedBy) { stat("MeterReading").skipped++; continue; }
    // keep the linkedIssueId only if that issue is being imported (else null)
    const linked = mr.linkedIssueId && newIssueIds.has(mr.linkedIssueId) ? mr.linkedIssueId : null;
    if (APPLY) insMr.run(mr.id, mr.value, mr.readingType ?? null, mr.readingDate, mr.source ?? "IMPORT", mr.createdAt ?? now, assetV2, recordedBy, linked);
    importedMr.add(mr.id);
    stat("MeterReading").created++;
  }

  // ---- 5. Fuel issues --------------------------------------------------------
  const v2PriceKey = new Map((v2.prepare("SELECT id, fuelKind, effectiveFrom FROM FuelPrice").all() as any[]).map((p) => [`${p.fuelKind}|${p.effectiveFrom}`, p.id]));
  const srcPrice = new Map((src.prepare("SELECT id, fuelKind, effectiveFrom FROM FuelPrice").all() as any[]).map((p) => [p.id, p]));
  const v2TankByName = new Map((v2.prepare("SELECT id, name FROM BulkTank").all() as any[]).map((t) => [t.name, t.id]));
  const srcTank = new Map((src.prepare("SELECT id, name FROM BulkTank").all() as any[]).map((t) => [t.id, t.name]));
  const insFi = v2.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,linkedRequestId,meterReadingRecordId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);

  for (const f of newIssues) {
    const assetV2 = resolveAsset(f.assetId);
    if (!assetV2) { stat("FuelIssue").skipped++; notes.push(`skip issue ${f.id}: unresolved asset ${srcAsset.get(f.assetId)?.code}`); continue; }
    const issuedBy = srcUserToV2.get(f.issuedById) ?? admin?.id ?? null;
    if (!issuedBy) { stat("FuelIssue").skipped++; continue; }
    const priceRow = f.fuelPriceId ? srcPrice.get(f.fuelPriceId) : null;
    const fuelPriceId = priceRow ? v2PriceKey.get(`${priceRow.fuelKind}|${priceRow.effectiveFrom}`) ?? null : null;
    const bulkTankId = f.bulkTankId ? v2TankByName.get(srcTank.get(f.bulkTankId)) ?? null : null;
    const mrLink = f.meterReadingRecordId && (importedMr.has(f.meterReadingRecordId) || v2MrIds.has(f.meterReadingRecordId)) ? f.meterReadingRecordId : null;
    if (APPLY) insFi.run(f.id, f.fuelKind, f.litres, f.meterReading ?? null, f.readingType ?? null, f.pricePerLitre, f.totalCost, f.source ?? "IMPORT", f.issueDate, f.createdAt ?? now, assetV2, issuedBy, fuelPriceId, null, mrLink, bulkTankId);
    stat("FuelIssue").created++;
  }

  if (APPLY) v2.exec("COMMIT"); else v2.exec("ROLLBACK");
} catch (err) {
  v2.exec("ROLLBACK");
  throw err;
}

console.log(`=== EXTERNAL FUEL IMPORT ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [t, s] of Object.entries(stats)) console.log(`  ${t.padEnd(14)} created ${String(s.created).padStart(4)}  matched ${String(s.matched).padStart(4)}  skipped ${String(s.skipped).padStart(4)}`);
if (notes.length) { console.log(`\n  notes:`); for (const n of [...new Set(notes)].slice(0, 14)) console.log(`   · ${n}`); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
src.close();
v2.close();
