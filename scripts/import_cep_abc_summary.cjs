// Import the CEP-03 A,B & C monthly "Vehicle Running Summary" workbooks (one file
// per month: Jan/Feb/Mar 2026). Unlike the daily site sheets, these carry only a
// MONTHLY fuel total per vehicle (no day grid), so — per the owner's decision —
// each vehicle's monthly fuel is posted as a single month-15 fuel issue. The
// hours/rates/amounts columns are left for the reference copy; only fuel is loaded.
//
// Both worksheet tabs ("Machinery" and "Plant expenses") are the same summary
// layout and are read. Matching to the fleet is by the single Vehicle-No column
// (code first, then regNo; a digit is required so descriptive words can't hit a
// junk placeholder). Missing vehicles are created (correct category), pinned to
// the site. Fuel per (asset, month) is aggregated, so a vehicle listed on both
// tabs yields one combined issue — no duplication.
//
// Replace-by-tank + deterministic codes make it idempotent (re-run lands the same
// rows). Dry-run by default; --apply writes.

const ExcelJS = require("exceljs");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const SITE = "CEP-03 A,B & C Package";
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const SOURCES = [
  { file: "data/source-sheets/CEP03_ABC_January_2026.xlsx",  year: 2026, month: 1 },
  { file: "data/source-sheets/CEP03_ABC_February_2026.xlsx", year: 2026, month: 2 },
  { file: "data/source-sheets/CEP03_ABC_March_2026.xlsx",    year: 2026, month: 3 },
];
const TABS = ["Machinery ", "Machinery", "Plant expenses"]; // trailing space varies

// ---- helpers ----
const cellV = (c) => { let v = c.value; if (v && typeof v === "object" && v.result !== undefined) v = v.result; if (v && typeof v === "object" && v.text !== undefined) v = v.text; return v; };
const str = (v) => (v === null || v === undefined) ? "" : String(v).trim();
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isFinite(n) ? n : null; };
const iso = (y, mo, d) => new Date(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T00:00:00.000+05:30`).toISOString();
const lastDay = (y, mo) => new Date(y, mo, 0).getDate();
const JUNK = /^total|vehicle running|vehicle no|^no$|owner|package|^type$/i;

// ---- fleet matching (code-first, digit-guarded) ----
const assets = db.prepare("SELECT id,code,regNo,typeLabel,meterType,projectId FROM Asset").all();
const alnum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const byCodeAl = new Map(assets.map((a) => [alnum(a.code), a]));
const byRegAl = new Map(); for (const a of assets) if (a.regNo && !byRegAl.has(alnum(a.regNo))) byRegAl.set(alnum(a.regNo), a);
const existingCodes = new Set(assets.map((a) => a.code.toUpperCase()));
function matchAsset(vno) {
  if (!/\d/.test(vno)) return null; // need a plate/code, not a bare word
  const c = byCodeAl.get(alnum(vno)); if (c) return { asset: c, via: "code/reg-as-code" };
  const r = byRegAl.get(alnum(vno)); if (r) return { asset: r, via: "regNo" };
  return null;
}

// ---- category / meter inference for new assets ----
const cats = new Map(db.prepare("SELECT name,id FROM Category").all().map((c) => [c.name, c.id]));
const catId = (n) => cats.get(n) || cats.get("Other Asset");
const isPlate = (s) => /^[A-Za-z]{0,4}[-\s]?\d{2,4}[-\s]?\d{0,4}$/.test((s || "").trim());
function classify(type, vno) {
  const t = `${type} ${vno}`.toLowerCase();
  if (/jcb|backhoe/.test(t))                 return { cat: "Backhoe Loader", meter: "HOURS" };
  if (/excavat|hex/.test(t))                 return { cat: "Excavator", meter: "HOURS" };
  if (/truck\s*mixer|mixer truck/.test(t))   return { cat: "Truck Mixer", meter: "KM" };
  if (/mixer|mix\b/.test(t))                 return { cat: "PE - Concrete Mixer", meter: "HOURS" };
  if (/loader/.test(t))                      return { cat: "Wheel Loader", meter: "HOURS" };
  if (/gen(a|e)r/.test(t))                   return { cat: "Generator", meter: "HOURS" };
  if (/roller/.test(t))                      return { cat: "Vibrating Roller", meter: "HOURS" };
  if (/compres|compos|compes|air comp/.test(t)) return { cat: "PE - Air Compressor", meter: "HOURS" };
  if (/pump/.test(t))                        return { cat: "PE - Engine Water Pump", meter: "HOURS" };
  if (/bowser/.test(t))                      return { cat: "Water Bowser", meter: "KM" };
  if (/cube|tipper|dump|lorry|truck/.test(t)) return { cat: "Dump Truck (Tipper)", meter: "KM" };
  if (/prime\s*mover|low\s*bed|\bbed\b/.test(t)) return { cat: "Prime Mover / Bed", meter: "KM" };
  if (/crew\s*cab/.test(t))                  return { cat: "Crew Cab", meter: "KM" };
  if (/double\s*cab|d\/cab/.test(t))         return { cat: "Double Cab (Pickup)", meter: "KM" };
  if (/single\s*cab|s\/cab/.test(t))         return { cat: "Single Cab", meter: "KM" };
  if (/tractor/.test(t))                     return { cat: "Farm Tractor", meter: "HOURS" };
  if (/motor|bike/.test(t))                  return { cat: "Motor Bicycle", meter: "KM" };
  return { cat: "Other Asset", meter: "KM" };
}

// ---- prices ----
const prices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all();
const priceFor = (day) => prices.find((p) => p.d <= day) ?? prices[prices.length - 1];

// ---- parse a summary sheet: [{vno, type, fuel, owner}] ----
function parseSheet(ws) {
  let hdr = null;
  for (let r = 1; r <= 5; r++) if (/vehicle no/i.test(str(cellV(ws.getRow(r).getCell(2))))) { hdr = r; break; }
  if (hdr === null) return [];
  // fuel column = the header cell equal to "Fuel"
  let fuelCol = 7;
  for (let c = 4; c <= ws.columnCount; c++) if (/^fuel$/i.test(str(cellV(ws.getRow(hdr).getCell(c))))) { fuelCol = c; break; }
  const rows = [];
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const vno = str(cellV(ws.getRow(r).getCell(2)));
    if (!vno || JUNK.test(vno)) continue;
    const fuel = num(cellV(ws.getRow(r).getCell(fuelCol)));
    if (!fuel || fuel <= 0) continue; // fuel-only import
    rows.push({ vno, type: str(cellV(ws.getRow(r).getCell(3))), fuel });
  }
  return rows;
}

(async () => {
  const project = db.prepare("SELECT id,name FROM Project WHERE name=?").get(SITE);
  if (!project) throw new Error(`Project not found: ${SITE}`);
  const tank = db.prepare("SELECT id FROM BulkTank WHERE projectId=?").get(project.id);
  if (!tank) throw new Error(`Tank not found for ${SITE}`);

  // gather (vno -> {type}) and per-month fuel from all files/tabs
  const sheetFuelByMonth = {}; // month -> total fuel in sheets (for reconcile)
  const rowsAll = []; // {year, month, vno, type, fuel}
  for (const s of SOURCES) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(process.cwd(), s.file));
    const seen = new Set();
    for (const tabName of TABS) {
      const ws = wb.getWorksheet(tabName); if (!ws || seen.has(ws.id)) continue; seen.add(ws.id);
      for (const row of parseSheet(ws)) { rowsAll.push({ ...s, ...row }); sheetFuelByMonth[s.month] = (sheetFuelByMonth[s.month] || 0) + row.fuel; }
    }
  }

  const now = new Date().toISOString();
  const stats = { matched: 0, created: 0, issues: 0, litres: 0, assignments: 0 };
  const matchedList = [], createdList = [];
  const resolved = new Map(); // alnum(vno) -> {id, code, created}

  const insAsset = db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const insAsg = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  const updPin = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);

  function resolve(vno, type) {
    const key = alnum(vno);
    if (resolved.has(key)) return resolved.get(key);
    const hit = matchAsset(vno);
    let rec;
    if (hit) { stats.matched++; rec = { id: hit.asset.id, code: hit.asset.code, created: false }; matchedList.push({ vno, asset: hit.asset.code, via: hit.via }); }
    else {
      const { cat, meter } = classify(type, vno);
      const code = vno.trim().toUpperCase();
      const existing = db.prepare("SELECT id,code FROM Asset WHERE UPPER(code)=UPPER(?)").get(code);
      if (existing) { stats.matched++; rec = { id: existing.id, code: existing.code, created: false }; matchedList.push({ vno, asset: existing.code, via: "code (prior import)" }); }
      else {
        const regNo = isPlate(vno) && !byRegAl.has(alnum(vno)) ? code : null;
        const id = randomUUID();
        if (APPLY) insAsset.run(id, code, regNo, type || cat, "ACTIVE", meter, "OWNED", now, now, catId(cat), project.id);
        existingCodes.add(code);
        stats.created++; rec = { id, code, created: true };
        createdList.push({ code, type, cat, meter });
      }
    }
    resolved.set(key, rec);
    return rec;
  }

  if (APPLY) { db.pragma("defer_foreign_keys = ON"); db.exec("BEGIN"); }
  try {
    // replace scope: clear this site's fuel issues + assignments before reload
    if (APPLY) {
      db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId=?`).run(tank.id);
      db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId=?`).run(project.id);
    }

    // aggregate fuel per (assetId, month); resolve/create assets
    const perAssetMonth = new Map(); // `${assetId}|${month}` -> {assetId, year, month, litres, code}
    const windows = new Map();       // assetId -> {firstMo, lastMo, code}
    for (const r of rowsAll) {
      const a = resolve(r.vno, r.type);
      const k = `${a.id}|${r.month}`;
      const cur = perAssetMonth.get(k) ?? { assetId: a.id, year: r.year, month: r.month, litres: 0, code: a.code };
      cur.litres += r.fuel; perAssetMonth.set(k, cur);
      const w = windows.get(a.id) ?? { firstMo: r.month, lastMo: r.month, code: a.code };
      w.firstMo = Math.min(w.firstMo, r.month); w.lastMo = Math.max(w.lastMo, r.month);
      windows.set(a.id, w);
    }

    // one month-15 issue per (asset, month)
    for (const e of perAssetMonth.values()) {
      const dayIso = `${e.year}-${String(e.month).padStart(2,"0")}-15`;
      const price = priceFor(dayIso);
      if (APPLY) insFi.run(randomUUID(), "AUTO_DIESEL", e.litres, null, null, price.c, Math.round(e.litres * price.c), "CEP-03 ABC monthly summary", iso(e.year, e.month, 15), now, e.assetId, ADMIN_ID, price.id, tank.id);
      stats.issues++; stats.litres += e.litres;
    }

    // one assignment per asset spanning its active months (standard site)
    for (const [assetId, w] of windows) {
      const startIso = iso(2026, w.firstMo, 1);
      const endIso = new Date(`2026-${String(w.lastMo).padStart(2,"0")}-${String(lastDay(2026, w.lastMo)).padStart(2,"0")}T23:59:59.999+05:30`).toISOString();
      if (APPLY) { insAsg.run(randomUUID(), assetId, project.id, startIso, endIso, "CEP-03 ABC monthly summary", now, now, ADMIN_ID); updPin.run(project.id, now, assetId); }
      stats.assignments++;
    }

    if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN_ID, "CREATE", "Project", project.id, `Imported CEP-03 A,B & C monthly fuel (${stats.issues} issues, ${Math.round(stats.litres)} L, ${stats.created} new assets)`, now);

    if (APPLY) db.exec("COMMIT");
  } catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

  // ---- report ----
  console.log(`\n=== CEP-03 A,B & C MONTHLY FUEL ${APPLY ? "APPLIED" : "DRY-RUN"} ===\n`);
  console.log(`Assets: ${stats.matched} matched, ${stats.created} created`);
  if (createdList.length) { console.log("Created:"); for (const c of createdList) console.log(`   + ${c.code.padEnd(12)} ${c.cat.padEnd(24)} ${c.meter}  (${c.type})`); }
  console.log(`\nFuel captured per month (sheet Fuel column sum):`);
  for (const m of [1, 2, 3]) console.log(`   ${["","Jan","Feb","Mar"][m]}: ${Math.round(sheetFuelByMonth[m] || 0)} L`);
  console.log(`\nFuel issues: ${stats.issues}  (${Math.round(stats.litres)} L, dated the 15th of each month)`);
  console.log(`Assignments: ${stats.assignments}`);
  if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write.`);
  db.close();
})();
