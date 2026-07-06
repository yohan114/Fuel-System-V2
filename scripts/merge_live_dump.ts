import Database from "better-sqlite3";
import path from "path";

// One-off merge of the live production system's data dump ("fuelsystem",
// uploaded 2026-07-06) into this system's database. The live app shares this
// repo's schema lineage (same _init migrations) but ran as a separate
// operation: its own sites (Badalgama Plant, Ruwanwella Water Project, …),
// 121 vehicles this DB doesn't have, one bulk tank, two users and ~1,064 fuel
// issues Mar–Jun 2026 — verified ZERO overlap with existing rows by
// (asset, day, litres) before this was written.
//
// Strategy: match master data by natural key (Category.name, Project.code,
// BulkTank.name, User.username, Asset.code, FuelPrice[fuelKind+effectiveFrom]),
// create what's missing (keeping the live row's id so re-runs are idempotent),
// then copy transactional rows (meter readings → fuel issues → conditions →
// bulk requests → audit log) with foreign keys remapped and duplicate guards
// on the natural keys. Existing rows are never updated — this DB stays
// authoritative for anything both sides know.
//
// Dry-run by default; --apply writes (single transaction).

const APPLY = process.argv.includes("--apply");
const LIVE_PATH = process.argv.find((a) => a.startsWith("--live="))?.slice(7)
  || "/tmp/claude-0/-home-user-Fuel-System-V2/ddd640e9-2dc1-5d1a-9875-08410003a7a4/scratchpad/upload/fuelsystem/data/app.db";

const live = new Database(LIVE_PATH, { readonly: true });
const v2 = new Database(path.join(process.cwd(), "data", "app.db"));

const day = (iso: string | null) => (iso || "").slice(0, 10);

function sharedCols(table: string): string[] {
  const l = live.prepare(`PRAGMA table_info("${table}")`).all().map((c: any) => c.name);
  const v = new Set(v2.prepare(`PRAGMA table_info("${table}")`).all().map((c: any) => c.name));
  return l.filter((c: string) => v.has(c));
}

// Insert a live row into v2 keeping its id, with FK overrides applied.
function makeInserter(table: string) {
  const cols = sharedCols(table);
  const stmt = v2.prepare(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`,
  );
  return (row: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    const data: Record<string, unknown> = {};
    for (const c of cols) data[c] = c in overrides ? overrides[c] : (row as any)[c];
    if (APPLY) stmt.run(data);
  };
}

interface Stat { matched: number; created: number; skipped: number }
const stats: Record<string, Stat> = {};
const stat = (t: string): Stat => (stats[t] ??= { matched: 0, created: 0, skipped: 0 });

v2.exec("BEGIN");
// MeterReading.linkedIssueId and FuelIssue.meterReadingRecordId reference each
// other, so insertion order alone can't satisfy immediate FK checks — defer
// them to COMMIT (both sides exist by then; resets automatically afterwards).
v2.pragma("defer_foreign_keys = ON");
try {
  // ---- Category ---------------------------------------------------------------
  // Matched by CODE — the unique key, and the org's own E&C-prefix taxonomy
  // (both systems label the same codes with name variants, e.g. live
  // "Dump Truck" = DT = "Dump Truck (Tipper)" here). Name differences are
  // reported, never merged on.
  const catMap = new Map<string, string>();
  {
    const ins = makeInserter("Category");
    const byCode = new Map(v2.prepare("SELECT id, code, name FROM Category").all().map((r: any) => [r.code, r]));
    for (const c of live.prepare("SELECT * FROM Category").all() as any[]) {
      const hit = byCode.get(c.code);
      if (hit) {
        catMap.set(c.id, hit.id);
        stat("Category").matched++;
        if (hit.name !== c.name) console.log(`  · category ${c.code}: live name "${c.name}" kept as "${hit.name}"`);
      } else {
        ins(c);
        catMap.set(c.id, c.id);
        stat("Category").created++;
      }
    }
  }

  // ---- Project (by code; live codes verified disjoint) ----------------------
  const projMap = new Map<string, string>();
  {
    const ins = makeInserter("Project");
    const byCode = new Map(v2.prepare("SELECT id, code FROM Project").all().map((r: any) => [r.code, r.id]));
    for (const p of live.prepare("SELECT * FROM Project").all() as any[]) {
      const hit = byCode.get(p.code);
      if (hit) { projMap.set(p.id, hit); stat("Project").matched++; }
      else { ins(p); projMap.set(p.id, p.id); stat("Project").created++; }
    }
  }

  // ---- BulkTank (by name) ----------------------------------------------------
  const tankMap = new Map<string, string>();
  {
    const ins = makeInserter("BulkTank");
    const byName = new Map(v2.prepare("SELECT id, name FROM BulkTank").all().map((r: any) => [r.name, r.id]));
    for (const t of live.prepare("SELECT * FROM BulkTank").all() as any[]) {
      const hit = byName.get(t.name);
      if (hit) { tankMap.set(t.id, hit); stat("BulkTank").matched++; }
      else { ins(t, { projectId: t.projectId ? projMap.get(t.projectId) ?? null : null }); tankMap.set(t.id, t.id); stat("BulkTank").created++; }
    }
  }

  // ---- User (by username; keep live passwordHash so logins keep working) ----
  const userMap = new Map<string, string>();
  {
    const ins = makeInserter("User");
    const byName = new Map(v2.prepare("SELECT id, username FROM User").all().map((r: any) => [r.username, r.id]));
    const liveUsers = live.prepare("SELECT * FROM User").all() as any[];
    for (const u of liveUsers) {
      const hit = byName.get(u.username);
      if (hit) { userMap.set(u.id, hit); stat("User").matched++; }
    }
    for (const u of liveUsers) {
      if (userMap.has(u.id)) continue;
      ins(u, {
        projectId: u.projectId ? projMap.get(u.projectId) ?? null : null,
        bulkTankId: u.bulkTankId ? tankMap.get(u.bulkTankId) ?? null : null,
        createdById: u.createdById ? userMap.get(u.createdById) ?? null : null,
      });
      userMap.set(u.id, u.id);
      stat("User").created++;
    }
  }

  // ---- Asset (by code; existing rows stay authoritative) ---------------------
  const assetMap = new Map<string, string>();
  {
    const ins = makeInserter("Asset");
    const byCode = new Map(v2.prepare("SELECT id, code FROM Asset").all().map((r: any) => [r.code, r.id]));
    for (const a of live.prepare("SELECT * FROM Asset").all() as any[]) {
      const hit = byCode.get(a.code);
      if (hit) { assetMap.set(a.id, hit); stat("Asset").matched++; }
      else {
        ins(a, {
          categoryId: catMap.get(a.categoryId) ?? a.categoryId,
          projectId: a.projectId ? projMap.get(a.projectId) ?? null : null,
        });
        assetMap.set(a.id, a.id);
        stat("Asset").created++;
      }
    }
  }

  // ---- FuelPrice (unique [fuelKind, effectiveFrom]) ---------------------------
  const priceMap = new Map<string, string>();
  {
    const ins = makeInserter("FuelPrice");
    const byKey = new Map(v2.prepare("SELECT id, fuelKind, effectiveFrom FROM FuelPrice").all().map((r: any) => [`${r.fuelKind}|${r.effectiveFrom}`, r.id]));
    for (const p of live.prepare("SELECT * FROM FuelPrice").all() as any[]) {
      const hit = byKey.get(`${p.fuelKind}|${p.effectiveFrom}`);
      if (hit) { priceMap.set(p.id, hit); stat("FuelPrice").matched++; }
      else {
        ins(p, { enteredById: userMap.get(p.enteredById) ?? p.enteredById });
        priceMap.set(p.id, p.id);
        stat("FuelPrice").created++;
      }
    }
  }

  // ---- FuelIssue skip pre-pass ---------------------------------------------------
  // Decide up-front which live issues will be inserted, so meter readings can
  // null a linkedIssueId that points at a skipped duplicate (otherwise the
  // deferred FK check fails at COMMIT).
  const issueWillExist = new Set<string>();
  {
    const preExisting = new Set(v2.prepare("SELECT assetId, issueDate, litres, fuelKind FROM FuelIssue").all()
      .map((r: any) => `${r.assetId}|${day(r.issueDate)}|${r.litres}|${r.fuelKind}`));
    const exact = new Set<string>();
    for (const f of live.prepare("SELECT * FROM FuelIssue").all() as any[]) {
      const vAsset = assetMap.get(f.assetId);
      if (!vAsset) continue;
      const dayKey = `${vAsset}|${day(f.issueDate)}|${f.litres}|${f.fuelKind}`;
      const exactKey = `${vAsset}|${f.issueDate}|${f.litres}|${f.fuelKind}`;
      if (preExisting.has(dayKey) || exact.has(exactKey)) continue;
      exact.add(exactKey);
      issueWillExist.add(f.id);
    }
  }

  // ---- MeterReading (guard: asset+day+type+value) -----------------------------
  const mrMap = new Map<string, string>();
  {
    const ins = makeInserter("MeterReading");
    const byKey = new Map(v2.prepare("SELECT id, assetId, readingDate, readingType, value FROM MeterReading").all()
      .map((r: any) => [`${r.assetId}|${day(r.readingDate)}|${r.readingType}|${r.value}`, r.id]));
    for (const m of live.prepare("SELECT * FROM MeterReading").all() as any[]) {
      const vAsset = assetMap.get(m.assetId);
      if (!vAsset) { stat("MeterReading").skipped++; continue; }
      const hit = byKey.get(`${vAsset}|${day(m.readingDate)}|${m.readingType}|${m.value}`);
      if (hit) { mrMap.set(m.id, hit); stat("MeterReading").matched++; continue; }
      ins(m, {
        assetId: vAsset,
        recordedById: m.recordedById ? userMap.get(m.recordedById) ?? null : null,
        linkedIssueId: m.linkedIssueId && issueWillExist.has(m.linkedIssueId) ? m.linkedIssueId : null,
      });
      mrMap.set(m.id, m.id);
      stat("MeterReading").created++;
    }
  }

  // ---- FuelIssue -----------------------------------------------------------------
  // Two-stage duplicate guard: a live row is a cross-system duplicate when this
  // DB already had the same asset+day+litres+kind BEFORE the merge (62 such
  // rows verified — e.g. 57-3062's daily 25 L entries were recorded in both
  // systems). Within the live batch itself, same-day repeats are kept as long
  // as their full timestamps differ (two 10 L fills in one day are real).
  {
    const ins = makeInserter("FuelIssue");
    for (const f of live.prepare("SELECT * FROM FuelIssue").all() as any[]) {
      const vAsset = assetMap.get(f.assetId);
      if (!vAsset) { stat("FuelIssue").skipped++; continue; }
      if (!issueWillExist.has(f.id)) { stat("FuelIssue").matched++; continue; }
      ins(f, {
        assetId: vAsset,
        issuedById: userMap.get(f.issuedById) ?? f.issuedById,
        fuelPriceId: f.fuelPriceId ? priceMap.get(f.fuelPriceId) ?? null : null,
        meterReadingRecordId: f.meterReadingRecordId ? mrMap.get(f.meterReadingRecordId) ?? null : null,
        linkedRequestId: null, // live has no FuelRequest rows
        bulkTankId: f.bulkTankId ? tankMap.get(f.bulkTankId) ?? null : null,
      });
      stat("FuelIssue").created++;
    }
  }

  // ---- DailyCondition (unique [assetId, logDate]) --------------------------------
  {
    const ins = makeInserter("DailyCondition");
    const byKey = new Set(v2.prepare("SELECT assetId, logDate FROM DailyCondition").all().map((r: any) => `${r.assetId}|${day(r.logDate)}`));
    for (const c of live.prepare("SELECT * FROM DailyCondition").all() as any[]) {
      const vAsset = assetMap.get(c.assetId);
      if (!vAsset || byKey.has(`${vAsset}|${day(c.logDate)}`)) { stat("DailyCondition").skipped++; continue; }
      ins(c, { assetId: vAsset, recordedById: userMap.get(c.recordedById) ?? c.recordedById });
      stat("DailyCondition").created++;
    }
  }

  // ---- BulkRequest (by id) ---------------------------------------------------------
  // FK columns are discovered from the schema, not guessed — the live dump even
  // contains a reviewedById pointing at a user deleted from the live system, so
  // any unmappable reference becomes NULL rather than a dangling id.
  {
    const ins = makeInserter("BulkRequest");
    const ids = new Set(v2.prepare("SELECT id FROM BulkRequest").all().map((r: any) => r.id));
    const fks = v2.prepare('PRAGMA foreign_key_list("BulkRequest")').all() as any[];
    const mapFor: Record<string, Map<string, string>> = { User: userMap, BulkTank: tankMap };
    for (const b of live.prepare("SELECT * FROM BulkRequest").all() as any[]) {
      if (ids.has(b.id)) { stat("BulkRequest").matched++; continue; }
      const over: Record<string, unknown> = {};
      for (const fk of fks) {
        const m = mapFor[fk.table];
        if (m && b[fk.from] != null) over[fk.from] = m.get(b[fk.from]) ?? null;
      }
      ins(b, over);
      stat("BulkRequest").created++;
    }
  }

  // ---- AuditLog (by id — preserves the live system's operational trail) -----------
  {
    const ins = makeInserter("AuditLog");
    const ids = new Set(v2.prepare("SELECT id FROM AuditLog").all().map((r: any) => r.id));
    for (const a of live.prepare("SELECT * FROM AuditLog").all() as any[]) {
      if (ids.has(a.id)) { stat("AuditLog").matched++; continue; }
      ins(a, { actorId: a.actorId ? userMap.get(a.actorId) ?? null : null });
      stat("AuditLog").created++;
    }
  }

  if (APPLY) {
    v2.exec("COMMIT");
  } else {
    v2.exec("ROLLBACK");
  }
} catch (err) {
  v2.exec("ROLLBACK");
  throw err;
}

console.log(`=== MERGE ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} — live dump → data/app.db ===`);
for (const [t, s] of Object.entries(stats)) {
  console.log(`  ${t.padEnd(15)} matched ${String(s.matched).padStart(5)}  created ${String(s.created).padStart(5)}  skipped ${String(s.skipped).padStart(4)}`);
}
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");

live.close();
v2.close();
