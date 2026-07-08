/* eslint-disable */
// Load the master Consolidated Fuel Register (data/source-sheets/Consolidated_
// Fuel_Register.xlsx, "Daily Fuel Log" sheet) as the AUTHORITATIVE fuel dataset.
// It was consolidated from 27 source workbooks and is a superset of the per-site
// sheets loaded earlier, so this is a full REPLACE of the sites it covers (the
// target tanks are cleared first). Sites it does NOT cover (e.g. CEP-03 A,B & C,
// loaded from separate summaries) are untouched.
//
// Dedup notes (owner's "do not duplicate"):
//  - "CEP-03" (source cep_3) is the SAME site as "Galagedara" (79/101 entries are
//    exact date+vehicle+litres matches). The stock-book "Galagedara" label is the
//    complete/authoritative record, so "CEP-03" is skipped.
//  - Both "Daily Issue" and "Stock Issue" rows are real vehicle fuel issues.
//
// Vehicles are matched to the fleet by Company Code first, then Vehicle No
// (digit-guarded); missing ones are created. Each vehicle is then allocated
// (pinned + assignment) to the site of its most-recent month — the "last month
// vehicle list" per site.
//
// Dry-run by default; --apply writes.

const ExcelJS = require("exceljs");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const FILE = "data/source-sheets/Consolidated_Fuel_Register.xlsx";
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// register site label -> project name ("CEP-03" intentionally omitted = dup of Galagedara)
const SITE_MAP = {
  "Ambanpola": "Ambanpola",
  "Avissawella": "Avissawella Site",
  "CEP-03 E Package": "CEP-03 Epackage",
  "Galagedara": "CEP-03F Galagedara",
  "Inginimitiya": "Inginimitiya",
  "Karaitivu Bridge": "Karativu Bridge",
  "Lot 02": "ICDP Batti Lot-02",
  "Lot 04": "I Project - LOT-04",
  "Marawila": "Marawila Site",
  "Muthur Plant": "MUTHUR PLANT",
  "Pallanoya Bridge": "Pallanoya Bridge",
  "Ruwanwella": "Ruwanwella Water Project",
};
const SITE_ABBR = { "Ambanpola":"AMB","Avissawella Site":"AVIS","CEP-03 Epackage":"CEP03E","CEP-03F Galagedara":"GALA","Inginimitiya":"INGI","Karativu Bridge":"KB","ICDP Batti Lot-02":"LOT02","I Project - LOT-04":"LOT04","Marawila Site":"MARA","MUTHUR PLANT":"MUT","Pallanoya Bridge":"PN","Ruwanwella Water Project":"RWP" };
const LOAD_TYPES = new Set(["Daily Issue", "Stock Issue"]);
const SKIP_SITES = new Set(["CEP-03"]);

// ---- helpers ----
const cellV = (c) => { let v = c.value; if (v && typeof v === "object" && v.result !== undefined) v = v.result; if (v && typeof v === "object" && v.text !== undefined) v = v.text; return v; };
const str = (v) => (v === null || v === undefined) ? "" : String(v).trim();
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isFinite(n) ? n : null; };
const iso = (y, mo, d, endOfDay = false) => new Date(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T${endOfDay?"23:59:59.999":"00:00:00.000"}+05:30`).toISOString();
const lastDay = (y, mo) => new Date(y, mo, 0).getDate();
function dateParts(v) {
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  const m = String(v).match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  return null;
}
const fuelKindOf = (ft) => /petrol/i.test(ft) ? "PETROL_92" : "AUTO_DIESEL";

// ---- fleet matching (code-first, digit-guarded) ----
const assets = db.prepare("SELECT id,code,regNo,typeLabel,meterType,projectId FROM Asset").all();
const alnum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const byCodeAl = new Map(assets.map((a) => [alnum(a.code), a]));
const byRegAl = new Map(); for (const a of assets) if (a.regNo && !byRegAl.has(alnum(a.regNo))) byRegAl.set(alnum(a.regNo), a);
const existingCodes = new Set(assets.map((a) => a.code.toUpperCase()));
const USABLE = /^[A-Za-z]{1,6}[-/ ]?\d+[A-Za-z0-9-]*$/;
const isUsable = (c) => c && USABLE.test(c.trim()) && !/hired/i.test(c);
const isPlate = (s) => /^[A-Za-z]{0,4}[-\s]?\d{2,4}[-\s]?\d{0,4}$/.test((s || "").trim());
function matchAsset(code, reg) {
  const regReal = reg && /\d/.test(reg);
  if (isUsable(code)) {
    const c = byCodeAl.get(alnum(code)); if (c) return { asset: c, via: "code" };
    if (regReal) { const r = byCodeAl.get(alnum(reg)); if (r) return { asset: r, via: "reg-as-code" }; }
    return null;
  }
  if (regReal) {
    const r = byCodeAl.get(alnum(reg)); if (r) return { asset: r, via: "reg-as-code" };
    const rn = byRegAl.get(alnum(reg)); if (rn) return { asset: rn, via: "regNo" };
  }
  return null;
}
// recover a fleet code/plate from a messy label ("excavetor HEX-45", "LB-21 Repair",
// "PE-3723 ( surveyor )", "253-2574(Lab)", "D 4 D 1" -> D4D-01)
function normTok(t) { const m = t.match(/d\s*4\s*d\s*-?\s*(\d+)/i); return m ? `D4D-${String(+m[1]).padStart(2, "0")}` : t; }
function matchByTokens(s) {
  if (!s) return null;
  const d4d = s.match(/d\s*4\s*d\s*-?\s*\d+/i);
  const toks = d4d ? [d4d[0]] : String(s).split(/[\s()\[\]{},/]+/);
  for (const raw of toks) {
    const t = normTok(raw.trim());
    // only a code/plate-shaped token: letter+digit (HEX-45, PE-3723) or NN-NNNN plate
    if (!((/[A-Za-z]/.test(t) && /\d/.test(t)) || /^\d{2,3}-\d{3,4}$/.test(t))) continue;
    const c = byCodeAl.get(alnum(t)); if (c) return { asset: c, via: "token-code" };
    const rn = byRegAl.get(alnum(t)); if (rn) return { asset: rn, via: "token-regNo" };
  }
  return null;
}
const cats = new Map(db.prepare("SELECT name,id FROM Category").all().map((c) => [c.name, c.id]));
const catId = (n) => cats.get(n) || cats.get("Other Asset");
const CAT_PREFIX = { "Generator":"GEN","PE - Concrete Mixer":"MIX","PE - Poker / Concrete Vibrator":"PKR","Vibrating Roller":"RLR","PE - Air Compressor":"ACMP","Water Bowser":"WB","Truck Mixer":"TM" };
function classify(type, code, reg) {
  const t = `${type} ${code} ${reg}`.toLowerCase();
  if (/jcb|backhoe/.test(t)) return { cat: "Backhoe Loader", meter: "HOURS" };
  if (/excavat|hex/.test(t)) return { cat: "Excavator", meter: "HOURS" };
  if (/truck\s*mixer/.test(t)) return { cat: "Truck Mixer", meter: "KM" };
  if (/mixer|mich|mixch/.test(t)) return { cat: "PE - Concrete Mixer", meter: "HOURS" };
  if (/loader/.test(t)) return { cat: "Wheel Loader", meter: "HOURS" };
  if (/gen(a|e)r/.test(t)) return { cat: "Generator", meter: "HOURS" };
  if (/roller/.test(t)) return { cat: "Vibrating Roller", meter: "HOURS" };
  if (/compres|compos|compes|air comp/.test(t)) return { cat: "PE - Air Compressor", meter: "HOURS" };
  if (/poker|vibrator/.test(t)) return { cat: "PE - Poker / Concrete Vibrator", meter: "HOURS" };
  if (/pump/.test(t)) return { cat: "PE - Engine Water Pump", meter: "HOURS" };
  if (/bowser/.test(t)) return { cat: "Water Bowser", meter: "KM" };
  if (/cube|tipper|dump|lorry/.test(t)) return { cat: "Dump Truck (Tipper)", meter: "KM" };
  if (/prime\s*mover|low\s*bed|\bbed\b/.test(t)) return { cat: "Prime Mover / Bed", meter: "KM" };
  if (/crew\s*cab/.test(t)) return { cat: "Crew Cab", meter: "KM" };
  if (/double\s*cab|d\/cab/.test(t)) return { cat: "Double Cab (Pickup)", meter: "KM" };
  if (/single\s*cab|s\/cab/.test(t)) return { cat: "Single Cab", meter: "KM" };
  if (/tractor/.test(t)) return { cat: "Farm Tractor", meter: "HOURS" };
  if (/bike|motor|bicy/.test(t)) return { cat: "Motor Bicycle", meter: "KM" };
  if (/jeep|van/.test(t)) return { cat: "Van", meter: "KM" };
  return { cat: "Other Asset", meter: "KM" };
}

// ---- prices ----
const dieselPrices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all();
const priceFor = (dayIso) => dieselPrices.find((p) => p.d <= dayIso) ?? dieselPrices[dieselPrices.length - 1];
const DEFAULT_PETROL_CENTS = 29400;

(async () => {
  // resolve target projects/tanks
  const targets = {}; // siteLabel -> {project, tank, siteName}
  for (const [label, siteName] of Object.entries(SITE_MAP)) {
    const project = db.prepare("SELECT id,name FROM Project WHERE name=?").get(siteName);
    if (!project) throw new Error(`Project not found: ${siteName} (for register site "${label}")`);
    const tank = db.prepare("SELECT id FROM BulkTank WHERE projectId=?").get(project.id);
    if (!tank) throw new Error(`Tank not found for ${siteName}`);
    targets[label] = { project, tank, siteName };
  }

  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(process.cwd(), FILE));
  const ws = wb.getWorksheet("Daily Fuel Log");
  const receiptWs = ws; // receipts are in the same log (Fuel Received)

  const now = new Date().toISOString();
  const stats = { rows: 0, issues: 0, litres: 0, matched: 0, created: 0, receipts: 0, receiptL: 0, meters: 0, skippedNoDate: 0, skippedDup: 0 };
  const createdList = [];
  const resolved = new Map();
  const targetByCode = new Map(); // deterministic-code -> resolved record (run-local dedup)

  const insAsset = db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const insMr = db.prepare(`INSERT INTO "MeterReading" (id,value,readingType,readingDate,source,createdAt,assetId,recordedById) VALUES (?,?,?,?,?,?,?,?)`);
  const insReq = db.prepare(`INSERT INTO "BulkRequest" (id,fuelKind,requestedLitres,status,createdAt,updatedAt,bulkTankId,requestedById,reviewedById,reviewedAt,reviewNote) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insAsg = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  const updPin = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);

  function resolve(code, reg, type, project) {
    const key = `${alnum(code)}|${alnum(reg)}`;
    if (resolved.has(key)) return resolved.get(key);
    // match: code/reg, then a code/plate token buried in a messy label
    const hit = matchAsset(code, reg) || matchByTokens(reg) || matchByTokens(code);
    let rec;
    if (hit) { stats.matched++; rec = { id: hit.asset.id, code: hit.asset.code, meter: hit.asset.meterType || "KM" }; }
    else {
      const { cat, meter } = classify(type, code, reg);
      const usable = isUsable(code), plate = !usable && isPlate(reg);
      const prefix = CAT_PREFIX[cat] || alnum(cat).slice(0, 3) || "EQ";
      // deterministic target: a real code, a plate, else a category-per-site slug
      // (so distinct un-coded misc fuel collapses into one catch-all per site)
      const target = usable ? code.trim().toUpperCase().replace(/\s+/g, "-")
                   : plate ? reg.trim().toUpperCase()
                   : `${prefix}-${SITE_ABBR[project.name] || "X"}`;
      // dedup by target within this run (consistent in dry-run and apply)
      if (targetByCode.has(target)) rec = targetByCode.get(target);
      else {
        const existing = db.prepare("SELECT id,code,meterType FROM Asset WHERE UPPER(code)=UPPER(?)").get(target);
        if (existing) { stats.matched++; rec = { id: existing.id, code: existing.code, meter: existing.meterType || meter }; }
        else {
          const regUsed = byRegAl.has(alnum(reg)) || byCodeAl.has(alnum(reg));
          const regNo = isPlate(reg) && !regUsed ? reg.trim().toUpperCase() : null;
          const id = randomUUID();
          if (APPLY) insAsset.run(id, target, regNo, type || cat, "ACTIVE", meter, /hire/i.test(code) ? "HIRED" : "OWNED", now, now, catId(cat), project.id);
          existingCodes.add(target.toUpperCase());
          stats.created++; rec = { id, code: target, meter };
          createdList.push({ code: target, type: type || cat, cat, site: project.name });
        }
        targetByCode.set(target, rec);
      }
    }
    resolved.set(key, rec);
    return rec;
  }

  if (APPLY) { db.pragma("defer_foreign_keys = ON"); db.exec("BEGIN"); }
  try {
    // clear all target tanks (full replace of the covered sites)
    if (APPLY) for (const t of Object.values(targets)) {
      db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId=?`).run(t.tank.id);
      db.prepare(`DELETE FROM "BulkRequest" WHERE bulkTankId=?`).run(t.tank.id);
      db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId=?`).run(t.project.id);
      db.prepare(`DELETE FROM "MeterReading" WHERE source='IMPORT' AND assetId IN (SELECT id FROM Asset WHERE projectId=?)`).run(t.project.id);
    }

    // per-asset latest-month site (for allocation) and per (asset,site) window
    const latest = new Map();       // assetId -> {y, m, projectId, siteName}
    const spans = new Map();        // `${assetId}|${projectId}` -> {assetId, projectId, min, max}
    const seenRows = new Set();     // exact source-row dedup key

    for (let r = 2; r <= ws.rowCount; r++) {
      const site = str(cellV(ws.getRow(r).getCell(1)));
      if (!site || SKIP_SITES.has(site)) continue;
      const t = targets[site]; if (!t) continue; // unmapped site
      const rt = str(cellV(ws.getRow(r).getCell(2)));
      const issued = num(cellV(ws.getRow(r).getCell(10)));
      const received = num(cellV(ws.getRow(r).getCell(11)));
      const dp = dateParts(cellV(ws.getRow(r).getCell(3)));

      // receipts (tank top-ups)
      if (received && received > 0) {
        if (dp && APPLY) insReq.run(randomUUID(), "AUTO_DIESEL", received, "APPROVED", iso(dp.y, dp.m, dp.d), iso(dp.y, dp.m, dp.d), t.tank.id, ADMIN_ID, ADMIN_ID, iso(dp.y, dp.m, dp.d), `Register: ${rt}`);
        if (dp) { stats.receipts++; stats.receiptL += received; }
        continue;
      }
      if (!LOAD_TYPES.has(rt) || !issued || issued <= 0) continue;
      if (!dp) { stats.skippedNoDate++; continue; }

      const vehNo = str(cellV(ws.getRow(r).getCell(6)));
      const code = str(cellV(ws.getRow(r).getCell(7)));
      if (!vehNo && !code) continue;
      const dayIso = `${dp.y}-${String(dp.m).padStart(2,"0")}-${String(dp.d).padStart(2,"0")}`;
      // drop truly-identical source rows (same site/date/label/litres/type) — real
      // register-internal duplicates. Different labels that share a catch-all are kept.
      const dk = `${site}|${dayIso}|${vehNo}|${code}|${issued}|${rt}`;
      if (seenRows.has(dk)) { stats.skippedDup++; continue; }
      seenRows.add(dk);
      const type = str(cellV(ws.getRow(r).getCell(8)));
      const a = resolve(code, vehNo, type, t.project);

      const fuelKind = fuelKindOf(str(cellV(ws.getRow(r).getCell(9))));
      const rate = num(cellV(ws.getRow(r).getCell(13)));
      const fp = fuelKind === "AUTO_DIESEL" ? priceFor(dayIso) : null;
      const ppl = rate != null && rate > 0 ? Math.round(rate * 100) : (fp ? fp.c : DEFAULT_PETROL_CENTS);
      const meter = num(cellV(ws.getRow(r).getCell(12)));

      if (APPLY) insFi.run(randomUUID(), fuelKind, issued, meter, meter != null ? a.meter : null, ppl, Math.round(issued * ppl), `Consolidated register (${site})`, iso(dp.y, dp.m, dp.d), now, a.id, ADMIN_ID, fp ? fp.id : null, t.tank.id);
      stats.issues++; stats.litres += issued; stats.rows++;
      if (meter != null && meter > 0) { if (APPLY) insMr.run(randomUUID(), meter, a.meter, iso(dp.y, dp.m, dp.d), "IMPORT", now, a.id, ADMIN_ID); stats.meters++; }

      // track latest-month site + span
      const cur = latest.get(a.id);
      if (!cur || dp.y > cur.y || (dp.y === cur.y && dp.m > cur.m)) latest.set(a.id, { y: dp.y, m: dp.m, projectId: t.project.id, siteName: t.siteName });
      const sk = `${a.id}|${t.project.id}`;
      const sp = spans.get(sk) ?? { assetId: a.id, projectId: t.project.id, min: dayIso, max: dayIso };
      if (dayIso < sp.min) sp.min = dayIso; if (dayIso > sp.max) sp.max = dayIso;
      spans.set(sk, sp);
    }

    // assignments per (asset, site) span
    for (const sp of spans.values()) {
      const s = sp.min.split("-").map(Number), e = sp.max.split("-").map(Number);
      if (APPLY) insAsg.run(randomUUID(), sp.assetId, sp.projectId, iso(s[0], s[1], s[2]), iso(e[0], e[1], e[2], true), "Consolidated register", now, now, ADMIN_ID);
      stats.assignments = (stats.assignments || 0) + 1;
    }
    // allocate each vehicle to its latest-month site (pin)
    for (const [assetId, L] of latest) if (APPLY) updPin.run(L.projectId, now, assetId);

    if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN_ID, "CREATE", "System", ADMIN_ID, `Loaded Consolidated Fuel Register: ${stats.issues} issues (${Math.round(stats.litres)} L) across ${Object.keys(targets).length} sites; ${stats.created} new assets; allocated ${latest.size} vehicles to latest-month sites`, now);

    if (APPLY) db.exec("COMMIT");
  } catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

  // ---- report ----
  console.log(`\n=== CONSOLIDATED REGISTER ${APPLY ? "APPLIED" : "DRY-RUN"} ===\n`);
  console.log(`Sites loaded: ${Object.keys(targets).length} (CEP-03 skipped as Galagedara duplicate)`);
  console.log(`Fuel issues:  ${stats.issues}  (${Math.round(stats.litres)} L)`);
  console.log(`Receipts:     ${stats.receipts}  (${Math.round(stats.receiptL)} L)`);
  console.log(`Meter reads:  ${stats.meters}`);
  console.log(`Assignments:  ${stats.assignments || 0}   Vehicles allocated to latest-month site: (${resolved.size} distinct)`);
  console.log(`Assets:       ${stats.matched} matched, ${stats.created} created`);
  if (stats.skippedNoDate) console.log(`Skipped (no date): ${stats.skippedNoDate}`);
  if (createdList.length) { console.log(`\nCreated assets (${createdList.length}):`); for (const c of createdList.slice(0, 40)) console.log(`   + ${c.code.padEnd(14)} ${c.cat.padEnd(24)} [${c.site}]  "${c.type}"`); if (createdList.length > 40) console.log(`   … +${createdList.length - 40} more`); }
  if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write.`);
  db.close();
})();
