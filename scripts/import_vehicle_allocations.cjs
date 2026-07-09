/**
 * Site-vehicle ALLOCATION master layer importer.
 *
 * Builds one clean record per vehicle × site × month from the Consolidated Fuel
 * Register's allocation-bearing sheets — Vehicle Monthly (∪) Vehicle Bill —
 * which pre-list the FULL fleet stationed at each site, not just the vehicles
 * that drew fuel. Owner is enriched from Running Summary. Populates the
 * VehicleAllocation table, resolving each raw site name to a Project and each
 * raw vehicle key to an Asset where possible (unmatched rows are kept with a
 * null FK + the raw key for audit; obvious junk rows are skipped and reported).
 *
 * SAFE + idempotent: additive only (writes VehicleAllocation, touches nothing
 * else). dedupeKey = "<projectCode|rawSite>|<month>|<normVeh>" so re-runs upsert
 * rather than duplicate. Dry-run by default; pass --apply to commit.
 *
 *   node scripts/import_vehicle_allocations.cjs            # dry-run (no writes)
 *   node scripts/import_vehicle_allocations.cjs --apply    # commit
 */
const ExcelJS = require("exceljs");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const SRC = process.env.SRC ||
  "/root/.claude/uploads/ddd640e9-2dc1-5d1a-9875-08410003a7a4/69b212dd-Consolidated_Fuel_Register.xlsx";
const APPLY = process.argv.includes("--apply");
const DB_PATH = path.join(process.cwd(), "data", "app.db");

const val = (row, c) => {
  let v = row.getCell(c).value;
  if (v && typeof v === "object") {
    if (v.result !== undefined) v = v.result;
    else if (v.text !== undefined) v = v.text;
    else if (v.richText) v = v.richText.map((t) => t.text).join("");
    else if (v instanceof Date) return v;
    else v = "";
  }
  return v === null || v === undefined ? "" : v;
};
const S = (x) => String(x).trim();
const norm = (x) => S(x).toUpperCase().replace(/\s+/g, "");
const alnum = (x) => S(x).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Raw workbook site name (normalised) → project code, for the 11 names whose
// spelling differs from the Project.name in the DB.
const SITE_ALIAS = {
  AVISSAWELLA: "AVIS",
  "BATTICALOAICDPLOT02": "BATTI-02",
  "BATTICALOAICDPLOT03": "BATTI",
  LOT02: "BATTI-02",
  LOT04: "LOT-04",
  "CEP-03A/B/C": "CEP-03-ABC",
  "CEP-03": "CEP-03F",       // register "CEP-03" == Galagedara package (per prior reconciliation)
  GALAGEDARA: "CEP-03F",
  KARAITIVUBRIDGE: "KB",
  MARAWILA: "MARA",
  RUWANWELLA: "RWP",
};

// A raw vehicle key that is clearly not a vehicle (data-entry note / activity).
const JUNK_RE = /(WORKSHOP|CLEAN|MOTOR|SURVEYOR|REPAIR|DELAY|FROMOIL|PAVER|OFFICER|WATER MOTOR)/i;
function looksLikeVehicle(raw) {
  const s = S(raw);
  if (!s) return false;
  if (JUNK_RE.test(s)) return false;
  const a = alnum(s);
  if (a.length < 2 || a.length > 14) return false;
  // A real key almost always carries a digit (reg-no or numbered machine code).
  if (!/[0-9]/.test(a)) return false;
  return true;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const sheet = (n) => wb.getWorksheet(n);
  const db = new Database(DB_PATH);

  // ---- Masters from DB ----
  const projects = db.prepare("SELECT id, code, name FROM Project").all();
  const projByCode = new Map(projects.map((p) => [p.code, p]));
  const projByNorm = new Map(projects.map((p) => [norm(p.name), p]));
  const assets = db.prepare("SELECT id, code, regNo, ownership FROM Asset").all();
  const assetBy = new Map();
  for (const a of assets) {
    for (const k of [norm(a.code), alnum(a.code), a.regNo ? norm(a.regNo) : null, a.regNo ? alnum(a.regNo) : null]) {
      if (k && !assetBy.has(k)) assetBy.set(k, a);
    }
  }

  const siteResolve = new Map();   // rawSite -> {project|null}
  const resolveSite = (rawSite) => {
    const raw = S(rawSite);
    if (siteResolve.has(raw)) return siteResolve.get(raw);
    let p = projByNorm.get(norm(raw)) || null;
    if (!p && SITE_ALIAS[norm(raw)]) p = projByCode.get(SITE_ALIAS[norm(raw)]) || null;
    if (!p && projByCode.get(raw)) p = projByCode.get(raw);
    siteResolve.set(raw, p);
    return p;
  };
  const resolveVeh = (rawVeh) => assetBy.get(norm(rawVeh)) || assetBy.get(alnum(rawVeh)) || null;

  // ---- Running Summary: owner by normVeh|month ----
  const ownerBy = new Map();
  const rs = sheet("Running Summary");
  for (let r = 2; r <= rs.rowCount; r++) {
    const veh = S(val(rs.getRow(r), 4)); if (!veh) continue;
    const month = S(val(rs.getRow(r), 2));
    const owner = S(val(rs.getRow(r), 14));
    if (owner) ownerBy.set(`${norm(veh)}|${month}`, owner);
  }

  // ---- Daily Fuel Log: which project|month|veh actually drew fuel ----
  const dailyKeys = new Set();
  const dfl = sheet("Daily Fuel Log");
  for (let r = 2; r <= dfl.rowCount; r++) {
    if (S(val(dfl.getRow(r), 2)) !== "Daily Issue") continue;
    const veh = S(val(dfl.getRow(r), 6)); if (!veh) continue;
    const p = resolveSite(val(dfl.getRow(r), 1));
    const key = `${p ? p.code : norm(val(dfl.getRow(r), 1))}|${S(val(dfl.getRow(r), 4))}|${norm(veh)}`;
    dailyKeys.add(key);
  }

  // ---- Vehicle Bill: strongest basis + machine per project|month|veh ----
  const BASIS_RANK = { "Fuel Report": 4, "Fuel Stock Issue": 3, "Hire Summary (Internal)": 2, "Hire Summary (External)": 1 };
  const billBy = new Map();
  const vbill = sheet("Vehicle Bill");
  for (let r = 5; r <= vbill.rowCount; r++) {
    const rawSite = S(val(vbill.getRow(r), 1)); if (!rawSite) continue;
    const veh = S(val(vbill.getRow(r), 3)); if (!veh) continue;
    const month = S(val(vbill.getRow(r), 2));
    const p = resolveSite(rawSite);
    const key = `${p ? p.code : norm(rawSite)}|${month}|${norm(veh)}`;
    const basis = S(val(vbill.getRow(r), 5));
    const prev = billBy.get(key);
    const rank = BASIS_RANK[basis] || 0;
    if (!prev || rank > prev.rank) {
      billBy.set(key, { rank, basis, machine: S(val(vbill.getRow(r), 4)), sourceFile: S(val(vbill.getRow(r), 11)), rawSite, veh, month });
    }
  }

  // ---- Build allocation map (Vehicle Monthly ∪ Vehicle Bill) ----
  const alloc = new Map();   // dedupeKey -> record
  const upsertAlloc = (rawSite, month, rawVeh, fields) => {
    const p = resolveSite(rawSite);
    const key = `${p ? p.code : norm(rawSite)}|${month}|${norm(rawVeh)}`;
    const cur = alloc.get(key) || {
      dedupeKey: key, project: p, siteName: rawSite, month, vehicleNo: rawVeh,
      machineType: null, ownerCode: null, basis: null, sourceFile: null, sourceSheet: null,
    };
    for (const [k, v] of Object.entries(fields)) if (v && !cur[k]) cur[k] = v;
    // Prefer a real (non-null) raw site/veh spelling if one arrives later.
    alloc.set(key, cur);
    return key;
  };

  const vm = sheet("Vehicle Monthly");
  let vmRows = 0;
  for (let r = 2; r <= vm.rowCount; r++) {
    const rawSite = S(val(vm.getRow(r), 1)); if (!rawSite) continue;
    const veh = S(val(vm.getRow(r), 3)); if (!veh) continue;
    const month = S(val(vm.getRow(r), 2));
    vmRows++;
    const key = upsertAlloc(rawSite, month, veh, {
      machineType: S(val(vm.getRow(r), 5)),
      sourceFile: S(val(vm.getRow(r), 19)),
      sourceSheet: S(val(vm.getRow(r), 20)),
    });
    const b = billBy.get(key);
    alloc.get(key).basis = alloc.get(key).basis || (b ? b.basis : "Fuel Report");
  }
  // Vehicle Bill-only keys (pure hire allocations that never appear in VM).
  for (const [key, b] of billBy) {
    if (alloc.has(key)) continue;
    upsertAlloc(b.rawSite, b.month, b.veh, { machineType: b.machine, basis: b.basis, sourceFile: b.sourceFile });
  }

  // Resolve vehicle + owner + active for every allocation.
  const latestMonthByVeh = new Map();
  for (const rec of alloc.values()) {
    const nv = norm(rec.vehicleNo);
    if (!latestMonthByVeh.has(nv) || rec.month > latestMonthByVeh.get(nv)) latestMonthByVeh.set(nv, rec.month);
  }
  let matchedVeh = 0, unmatchedPlausible = 0, junk = 0, noFuel = 0, activeCnt = 0;
  const junkSample = new Set(), unmatchedSample = new Set();
  const finalRecs = [];
  for (const rec of alloc.values()) {
    const asset = resolveVeh(rec.vehicleNo);
    if (!asset && !looksLikeVehicle(rec.vehicleNo)) { junk++; if (junkSample.size < 20) junkSample.add(rec.vehicleNo); continue; }
    if (asset) matchedVeh++; else { unmatchedPlausible++; if (unmatchedSample.size < 25) unmatchedSample.add(rec.vehicleNo); }

    const owner = ownerBy.get(`${norm(rec.vehicleNo)}|${rec.month}`)
      || (asset ? (asset.ownership === "HIRED" ? "Hired" : "E & C") : null);
    const active = latestMonthByVeh.get(norm(rec.vehicleNo)) === rec.month;
    if (active) activeCnt++;
    if (!dailyKeys.has(rec.dedupeKey)) noFuel++;

    finalRecs.push({
      id: crypto.randomUUID(),
      dedupeKey: rec.dedupeKey,
      projectId: rec.project ? rec.project.id : null,
      siteName: rec.siteName,
      month: rec.month,
      assetId: asset ? asset.id : null,
      vehicleNo: rec.vehicleNo,
      machineType: rec.machineType || null,
      ownerCode: owner,
      basis: rec.basis || null,
      active: active ? 1 : 0,
      sourceFile: rec.sourceFile || null,
      sourceSheet: rec.sourceSheet || null,
    });
  }

  // ---- Report ----
  const siteRows = [...siteResolve.entries()].map(([raw, p]) => `${p ? p.code.padEnd(11) : "UNMATCHED  "} ← ${raw}`);
  const basisDist = {}; const ownerDist = {};
  for (const r of finalRecs) { basisDist[r.basis || "(none)"] = (basisDist[r.basis || "(none)"] || 0) + 1; ownerDist[r.ownerCode || "(none)"] = (ownerDist[r.ownerCode || "(none)"] || 0) + 1; }
  const unmatchedSites = [...siteResolve.entries()].filter(([, p]) => !p).map(([raw]) => raw);

  console.log(`\n════ VEHICLE ALLOCATION IMPORT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
  console.log(`Source: ${path.basename(SRC)}`);
  console.log(`Vehicle Monthly rows read: ${vmRows} | Vehicle Bill keys: ${billBy.size}`);
  console.log(`\nAllocation records to write: ${finalRecs.length}`);
  console.log(`  vehicles matched to an asset : ${matchedVeh}`);
  console.log(`  unmatched but plausible (assetId=null, kept) : ${unmatchedPlausible}`);
  console.log(`  junk rows skipped            : ${junk}`);
  console.log(`  → allocations with NO daily fuel that month  : ${noFuel}`);
  console.log(`  → flagged active (latest month per vehicle)  : ${activeCnt}`);
  console.log(`\nSite resolution (${siteResolve.size} raw names):`);
  for (const line of siteRows.sort()) console.log("   " + line);
  if (unmatchedSites.length) console.log(`  ⚠ UNMATCHED sites: ${unmatchedSites.join(" | ")}`);
  console.log(`\nBasis distribution:`, Object.entries(basisDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", "));
  console.log(`Owner distribution:`, Object.entries(ownerDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", "));
  if (unmatchedSample.size) console.log(`\nUnmatched-but-kept vehicle sample:`, [...unmatchedSample].join(", "));
  if (junkSample.size) console.log(`Junk-skipped sample:`, [...junkSample].join(", "));

  // ---- Write (always inside a txn; commit only on --apply) ----
  const insert = db.prepare(`
    INSERT INTO VehicleAllocation
      (id, dedupeKey, projectId, siteName, month, assetId, vehicleNo, machineType, ownerCode, basis, active, sourceFile, sourceSheet, createdAt, updatedAt)
    VALUES
      (@id, @dedupeKey, @projectId, @siteName, @month, @assetId, @vehicleNo, @machineType, @ownerCode, @basis, @active, @sourceFile, @sourceSheet, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(dedupeKey) DO UPDATE SET
      projectId=excluded.projectId, siteName=excluded.siteName, assetId=excluded.assetId,
      vehicleNo=excluded.vehicleNo, machineType=excluded.machineType, ownerCode=excluded.ownerCode,
      basis=excluded.basis, active=excluded.active, sourceFile=excluded.sourceFile,
      sourceSheet=excluded.sourceSheet, updatedAt=CURRENT_TIMESTAMP
  `);
  db.exec("BEGIN");
  for (const r of finalRecs) insert.run(r);
  const total = db.prepare("SELECT COUNT(*) c FROM VehicleAllocation").get().c;
  if (APPLY) { db.exec("COMMIT"); console.log(`\n✓ APPLIED. VehicleAllocation now holds ${total} rows.`); }
  else { db.exec("ROLLBACK"); console.log(`\n(DRY-RUN) would upsert ${finalRecs.length} rows — nothing written. Re-run with --apply to commit.`); }
  db.close();
})();
