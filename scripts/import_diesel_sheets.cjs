/* eslint-disable */
// Import monthly "Diesel Details" workbooks (one per site) into the fuel system.
//
// Each workbook has one sheet per month (Jan–Jun 2026). A sheet is a day-grid:
//   row 3  = labels (S.No | Reg | Company Code | Type | Fuel | Day×31 | Totals…)
//   row 4  = day numbers 1..31 under the "Day" columns
//   row 5+ = one row per vehicle: daily litres, site-tank total, meters, rate
//   footer = "Daily Opening/Fuel Purchase/Closing balance at site tank" rows
//
// Matching to the existing fleet is CODE-FIRST because the sheets' Reg column is
// unreliable (a JCB and a generator were both tagged with a motorbike's plate):
//   1. company code (alphanumeric-normalised) -> Asset.code
//   2. if a code was given but missed: reg -> Asset.code  (reg-as-code, exact id)
//   3. if code empty/"Hired"/descriptive:  reg -> Asset.code, then reg -> Asset.regNo
//   4. otherwise CREATE the asset (correct category + hrs/km), pinned to the site.
// regNo-column matching is never used when a real code is present, so a plate
// collision can't merge two different machines.
//
// The load is a REPLACE scoped to each site's tank/project, so re-running lands
// the same result (no duplicates): it first clears that tank's fuel issues &
// receipts, the site's assignments, and IMPORT meter readings for its assets.
//
// Usage:  node scripts/import_diesel_sheets.cjs            (dry-run report)
//         node scripts/import_diesel_sheets.cjs --apply    (write)

const ExcelJS = require("exceljs");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// NOTE: the Consolidated Fuel Register (scripts/import_consolidated_register.cjs)
// is now the master source for the sites below — do NOT reload them here or you
// will overwrite the register's normalized data. To load a single NEW grid-format
// site (one not in the register, e.g. Badalgama), run with a filter, e.g.:
//   node scripts/import_diesel_sheets.cjs --apply only:Badalgama
// A source may list one `file` or several `files` (merged into one site).
const SOURCES = [
  { file: "data/source-sheets/Ambanpola_Diesel_Details.xlsx",    siteName: "Ambanpola" },
  { file: "data/source-sheets/Inginimitiya_Diesel_Details.xlsx", siteName: "Inginimitiya" },
  { file: "data/source-sheets/Muthur_Plant_Diesel_Details.xlsx", siteName: "MUTHUR PLANT" },
  { file: "data/source-sheets/Karativu_Diesel_Details.xlsx",     siteName: "Karativu Bridge" },
  { file: "data/source-sheets/Pallanoya_Diesel_Details.xlsx",    siteName: "Pallanoya Bridge" },
  { file: "data/source-sheets/Lot02_Batti_Diesel_Details.xlsx",  siteName: "ICDP Batti Lot-02" },
  { file: "data/source-sheets/Avissawella_Diesel_Details.xlsx",  siteName: "Avissawella Site", defaultYear: 2026 },
  { file: "data/source-sheets/Ruwanwella_Diesel_Details.xlsx",   siteName: "Ruwanwella Water Project" },
  // Badalgama is loaded from the archived app.db extract (Mar-Jun, more complete
  // than the Mar-May sheets) via scripts/import_badalgama_db.cjs, not here.
];
const ONLY = (process.argv.find((a) => a.startsWith("only:")) || "").slice(5).toLowerCase();

// ---------- xlsx helpers ----------
const cellV = (c) => { let v = c.value; if (v && typeof v === "object" && v.result !== undefined) v = v.result; if (v && typeof v === "object" && v.text !== undefined) v = v.text; return v; };
const str = (v) => (v === null || v === undefined) ? "" : String(v).trim();
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isFinite(n) ? n : null; };
const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
// tolerant month/year finder. Handles "January 2026", "March-2026", "June- 2026",
// "Feb 26" (2-digit), "Mrch - 2026" (typo) and month-only "March" (year=null,
// filled by the caller). Returns { month, year|null } or null when no month.
const MONTH_ALIASES = [[/\bjan/,1],[/\bfeb/,2],[/\bmar|\bmrch/,3],[/\bapr/,4],[/\bmay/,5],[/\bjun/,6],[/\bjul/,7],[/\baug/,8],[/\bsep/,9],[/\boct/,10],[/\bnov/,11],[/\bdec/,12]];
function parseMonthText(text) {
  const t = String(text || "").toLowerCase();
  let month = null;
  for (const [re, m] of MONTH_ALIASES) if (re.test(t)) { month = m; break; }
  if (!month) return null;
  let year = null;
  const y4 = t.match(/\b(20\d{2})\b/);
  if (y4) year = +y4[1];
  else { const y2 = t.match(/[a-z][-\s.']*(\d{2})\b/); if (y2) year = 2000 + +y2[1]; } // "Feb 26"
  return { month, year };
}
const iso = (y, mo, d, endOfDay = false) => new Date(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T${endOfDay?"23:59:59.999":"00:00:00.000"}+05:30`).toISOString();
const lastDayOfMonth = (y, mo) => new Date(y, mo, 0).getDate();

// rows that are headers / footers / section subtotals — never a vehicle
// (covers "Daily/Monthly Opening/Closing Balance", purchase & subtotal rows)
const JUNK = /daily|monthly|\bbalance\b|opening balance|fuel purchase|^total\b|total issue|vehicle reg|company code|type of vehicle|fuel type|s\.?\s*no\.?$/i;

function parseWorkbook(absPath, siteName, defaultYear) {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.readFile(absPath).then(() => {
    const months = [];
    wb.eachSheet((ws) => {
      // month from the sheet name, else from the header band (MUTHUR's single
      // "Fuel Report" sheet carries "June- 2026" in row 2)
      let ym = parseMonthText(ws.name);
      for (let r = 1; r <= 3 && !ym; r++) for (let c = 1; c <= ws.columnCount && !ym; c++) ym = parseMonthText(cellV(ws.getRow(r).getCell(c)));
      if (!ym) return;
      // year-less tab (Avissawella "March"): take a 20xx from the header band, else the source default
      if (ym.year == null) {
        let y = null;
        for (let r = 1; r <= 3 && !y; r++) for (let c = 1; c <= ws.columnCount && !y; c++) { const mm = String(cellV(ws.getRow(r).getCell(c)) ?? "").match(/\b(20\d{2})\b/); if (mm) y = +mm[1]; }
        ym.year = y ?? defaultYear ?? 2026;
      }
      // header row (col1 == "S. No.") and day-number row (find day "1" in cols 6-8,
      // since some sheets, e.g. Ruwanwella, put an Owner column at 6 and days at 7+)
      let hdr = null;
      for (let r = 1; r <= 6; r++) if (/S\.?\s*No/i.test(str(cellV(ws.getRow(r).getCell(1))))) { hdr = r; break; }
      if (hdr === null) hdr = 3;
      let dayRow = null;
      for (const r of [hdr + 1, hdr, hdr - 1]) { if ([6,7,8].some((cc) => num(cellV(ws.getRow(r).getCell(cc))) === 1)) { dayRow = r; break; } }
      if (dayRow === null) dayRow = hdr + 1;
      // totals columns by label text — scan both the header row and the
      // day-number row (some sheets, e.g. Lot-02, carry the labels on row 4)
      const col = { site:null, outside:null, total:null, open:null, close:null, rate:null };
      for (let c = 6; c <= ws.columnCount; c++) {
        const h = (str(cellV(ws.getRow(hdr).getCell(c))) + " " + str(cellV(ws.getRow(dayRow).getCell(c)))).toLowerCase();
        if (/site tank/.test(h)) col.site = c;
        else if (/outside/.test(h)) col.outside = c;
        else if (/total fuel/.test(h)) col.total = c;
        else if (/opening/.test(h)) col.open = c;
        else if (/closing/.test(h)) col.close = c;
        else if (/rate/.test(h)) col.rate = c;
      }
      const firstTotalCol = col.site || col.total || 37;
      const dayCols = [];
      for (let c = 6; c < firstTotalCol; c++) { const d = num(cellV(ws.getRow(dayRow).getCell(c))); if (d !== null && d >= 1 && d <= 31) dayCols.push({ col: c, day: d }); }

      const vehicles = [];
      const purchases = []; // {day, litres}
      let closingBalance = null;
      for (let r = dayRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const reg = str(cellV(row.getCell(2)));
        const code = str(cellV(row.getCell(3)));
        const label = `${reg} ${code} ${str(cellV(row.getCell(4)))}`; // include the type column
        // footer capture (daily OR monthly wording)
        if (/fuel purchase/i.test(label)) { for (const { col:c, day } of dayCols) { const l = num(cellV(row.getCell(c))); if (l && l > 0) purchases.push({ day, litres: l }); } continue; }
        if (/closing balance/i.test(label)) { for (const { col:c, day } of dayCols) { const l = num(cellV(row.getCell(c))); if (l !== null) closingBalance = l; } continue; }
        if (JUNK.test(label)) continue;
        if (!reg && !code) continue;
        const issues = [];
        for (const { col:c, day } of dayCols) { const l = num(cellV(row.getCell(c))); if (l !== null && l > 0) issues.push({ day, litres: l }); }
        const siteTankTot = col.site ? num(cellV(row.getCell(col.site))) : null;
        if (issues.length === 0 && !siteTankTot) continue; // no fuel this month
        vehicles.push({
          reg, code,
          type: str(cellV(row.getCell(4))),
          fuel: str(cellV(row.getCell(5))),
          issues,
          sumIssues: issues.reduce((s, i) => s + i.litres, 0),
          siteTankTot,
          openMeter: col.open ? num(cellV(row.getCell(col.open))) : null,
          closeMeter: col.close ? num(cellV(row.getCell(col.close))) : null,
        });
      }
      months.push({ sheet: ws.name, ...ym, dayCount: dayCols.length, vehicles, purchases, closingBalance });
    });
    return { siteName, months };
  });
}

// ---------- asset matching ----------
const assets = db.prepare("SELECT id,code,regNo,typeLabel,meterType,projectId FROM Asset").all();
const alnum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const byCodeAl = new Map(); for (const a of assets) byCodeAl.set(alnum(a.code), a);
const byRegAl = new Map(); for (const a of assets) if (a.regNo) if (!byRegAl.has(alnum(a.regNo))) byRegAl.set(alnum(a.regNo), a);

const USABLE_CODE = /^[A-Za-z]{1,6}[-/ ]?\d+[A-Za-z0-9-]*$/; // LB11, MB-11, SL/10, HCC-01, GE102, PA-6399
const isUsableCode = (c) => c && USABLE_CODE.test(c.trim()) && !/hired/i.test(c);

function matchAsset(code, reg) {
  // only trust reg for matching when it looks like a plate/code (has a digit) —
  // stops descriptive words ("Generator", "Crane") hitting junk placeholder assets
  const regReal = reg && /\d/.test(reg);
  if (isUsableCode(code)) {
    const byC = byCodeAl.get(alnum(code)); if (byC) return { asset: byC, via: "code" };
    // reg-as-code only (safe: exact identity on the code column)
    if (regReal) { const byR = byCodeAl.get(alnum(reg)); if (byR) return { asset: byR, via: "reg-as-code" }; }
    return null; // create under the given code
  }
  // no usable code -> lean on the plate
  if (regReal) {
    const byR = byCodeAl.get(alnum(reg)); if (byR) return { asset: byR, via: "reg-as-code" };
    const byRn = byRegAl.get(alnum(reg)); if (byRn) return { asset: byRn, via: "regNo" };
  }
  return null;
}

// ---------- category / meter inference for NEW assets ----------
const cats = new Map(db.prepare("SELECT name,id FROM Category").all().map((c) => [c.name, c.id]));
const catId = (n) => cats.get(n) || cats.get("Other Asset");
const isPlate = (reg) => /^[A-Za-z]{0,4}[-\s]?\d{2,4}[-\s]?\d{0,4}$/.test((reg || "").trim());
const SITE_ABBR = { Ambanpola: "AMB", Inginimitiya: "INGI", "MUTHUR PLANT": "MUT", "Karativu Bridge": "KB", "Pallanoya Bridge": "PN", "ICDP Batti Lot-02": "LOT02", "Avissawella Site": "AVIS", "Ruwanwella Water Project": "RWP", "Badalgama Plant/Workshop": "BADAL" };
const CAT_PREFIX = { "Generator":"GEN", "PE - Concrete Mixer":"MIX", "PE - Poker / Concrete Vibrator":"PKR", "PE - Power Tool — Other":"PT", "Workshop Plant / Equipment":"WSP", "Vibrating Roller":"RLR", "Static Roller":"RLR", "PE - Engine Water Pump":"PMP" };
function classify(type, code, reg) {
  const t = `${type} ${code} ${reg}`.toLowerCase();
  if (/jcb|backhoe/.test(t))                 return { cat: "Backhoe Loader", meter: "HOURS" };
  if (/excavat|hex/.test(t))                 return { cat: "Excavator", meter: "HOURS" };
  if (/gen(a|e)r|^ge/.test(t))               return { cat: "Generator", meter: "HOURS" };
  if (/bob\s*cat|skid|^sl/.test(t))          return { cat: "Skid Steer", meter: "HOURS" };
  if (/poker|vibrator/.test(t))              return { cat: "PE - Poker / Concrete Vibrator", meter: "HOURS" };
  if (/mix|mich/.test(t))                    return { cat: "PE - Concrete Mixer", meter: "HOURS" };
  if (/grass|gress|cutt/.test(t))            return { cat: "PE - Power Tool — Other", meter: "HOURS" };
  if (/board|form\s*work/.test(t))           return { cat: "Workshop Plant / Equipment", meter: "HOURS" };
  if (/roller/.test(t))                      return { cat: "Vibrating Roller", meter: "HOURS" };
  if (/pump/.test(t))                        return { cat: "PE - Engine Water Pump", meter: "HOURS" };
  if (/compres|compos|compes|air comp|\bac-?\d/.test(t)) return { cat: "PE - Air Compressor", meter: "HOURS" };
  if (/bowser/.test(t))                      return { cat: "Water Bowser", meter: "KM" };
  if (/prime\s*mover|low\s*bed|\bbed\b/.test(t)) return { cat: "Prime Mover / Bed", meter: "KM" };
  if (/crew\s*cab/.test(t))                  return { cat: "Crew Cab", meter: "KM" };
  if (/double\s*cab/.test(t))                return { cat: "Double Cab (Pickup)", meter: "KM" };
  if (/single\s*cab/.test(t))                return { cat: "Single Cab", meter: "KM" };
  if (/tractor/.test(t))                     return { cat: "Farm Tractor", meter: "HOURS" };
  if (/motor|bike|bicy/.test(t))             return { cat: "Motor Bicycle", meter: "KM" };
  if (/lorry|truck|tipper|dump/.test(t))     return { cat: "Dump Truck (Tipper)", meter: "KM" };
  if (/van/.test(t))                         return { cat: "Van", meter: "KM" };
  return { cat: "Other Asset", meter: "KM" };
}
// track codes we've handed out so a single run can't collide with itself
const existingCodes = new Set(assets.map((a) => a.code.toUpperCase()));

// ---------- prices ----------
const dieselPrices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all();
const priceFor = (dayIso) => dieselPrices.find((p) => p.d <= dayIso) ?? dieselPrices[dieselPrices.length - 1];

// ================= run =================
(async () => {
  const parsed = [];
  for (const s of SOURCES) {
    if (ONLY && !s.siteName.toLowerCase().includes(ONLY)) continue; // load only the matching site
    const files = s.files || [s.file];
    const months = [];
    for (const f of files) { const d = await parseWorkbook(path.join(process.cwd(), f), s.siteName, s.defaultYear); months.push(...d.months); }
    parsed.push({ ...s, data: { siteName: s.siteName, months } });
  }

  const stats = { assetsCreated: 0, assetsMatched: 0, issues: 0, litres: 0, meterReadings: 0, assignments: 0, receipts: 0, receiptLitres: 0 };
  const created = []; const matchedList = [];
  const reconOk = []; const reconBad = [];

  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const insMr = db.prepare(`INSERT INTO "MeterReading" (id,value,readingType,readingDate,source,createdAt,assetId,recordedById) VALUES (?,?,?,?,?,?,?,?)`);
  const insAsg = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insReq = db.prepare(`INSERT INTO "BulkRequest" (id,fuelKind,requestedLitres,status,createdAt,updatedAt,bulkTankId,requestedById,reviewedById,reviewedAt,reviewNote) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insAsset = db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const updPin = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);
  const now = new Date().toISOString();

  if (APPLY) { db.pragma("defer_foreign_keys = ON"); db.exec("BEGIN"); }
  try {
    // resolver caches an asset id per (code|reg) key across months/sites and
    // creates a NEW asset only once. Keeps a map of what we resolved for report.
    const resolvedById = new Map(); // key -> resolved record
    function resolve(v, project) {
      const usable = isUsableCode(v.code);
      const plate = !usable && isPlate(v.reg);
      const { cat, meter } = classify(v.type, v.code, v.reg);
      // one asset per real code (across sites/months); else per plate; else per
      // category-per-site (merges "gress/grase cutter" typo variants into one)
      const key = usable ? "C:" + alnum(v.code)
                : plate ? "R:" + alnum(v.reg)
                : "D:" + cat + ":" + project.siteName;
      if (resolvedById.has(key)) return resolvedById.get(key);
      const hit = matchAsset(v.code, v.reg);
      let rec;
      if (hit) {
        stats.assetsMatched++;
        rec = { id: hit.asset.id, code: hit.asset.code, created: false, meter: hit.asset.meterType || meter };
        matchedList.push({ site: project.siteName, sheetCode: v.code || "—", sheetReg: v.reg || "—", asset: hit.asset.code, via: hit.via });
      } else {
        // Deterministic target code so re-runs reuse the same asset (idempotent):
        //   real code as-given · a plate reg as-is · else CAT-SITE slug.
        const prefix = CAT_PREFIX[cat] || alnum(cat).slice(0, 3) || "EQ";
        const targetCode = usable ? v.code.trim().toUpperCase().replace(/\s+/g, "-")
                         : plate ? v.reg.trim().toUpperCase()
                         : `${prefix}-${SITE_ABBR[project.siteName] || "X"}`;
        const existing = db.prepare("SELECT id, code, meterType FROM Asset WHERE UPPER(code)=UPPER(?)").get(targetCode);
        if (existing) {
          stats.assetsMatched++;
          rec = { id: existing.id, code: existing.code, created: false, meter: existing.meterType || meter };
          matchedList.push({ site: project.siteName, sheetCode: v.code || "—", sheetReg: v.reg || "—", asset: existing.code, via: "code (prior import)" });
        } else {
          // only carry the plate onto the new asset if it's a real plate not already used
          const regUsed = byRegAl.has(alnum(v.reg)) || byCodeAl.has(alnum(v.reg));
          const regNo = isPlate(v.reg) && !regUsed ? v.reg.trim().toUpperCase() : null;
          const typeLabel = (v.type || v.code || v.reg || cat).trim();
          const id = randomUUID();
          if (APPLY) insAsset.run(id, targetCode, regNo, typeLabel, "ACTIVE", meter, /hire/i.test(v.code) ? "HIRED" : "OWNED", now, now, catId(cat), project.id);
          existingCodes.add(targetCode.toUpperCase());
          stats.assetsCreated++;
          rec = { id, code: targetCode, created: true, meter, cat };
          created.push({ site: project.siteName, code: targetCode, reg: v.reg, type: typeLabel, cat, meter, regNo });
        }
      }
      resolvedById.set(key, rec);
      return rec;
    }

    for (const s of parsed) {
      const project = db.prepare("SELECT id,name FROM Project WHERE name=?").get(s.siteName);
      if (!project) throw new Error(`Project not found: ${s.siteName}`);
      project.siteName = s.siteName;
      const tank = db.prepare("SELECT id FROM BulkTank WHERE projectId=?").get(project.id);
      if (!tank) throw new Error(`Tank not found for ${s.siteName}`);

      // REPLACE scope: clear this site's prior import so re-runs don't duplicate
      if (APPLY) {
        db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId=?`).run(tank.id);
        db.prepare(`DELETE FROM "BulkRequest" WHERE bulkTankId=?`).run(tank.id);
        db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId=?`).run(project.id);
        db.prepare(`DELETE FROM "MeterReading" WHERE source='IMPORT' AND assetId IN (SELECT id FROM Asset WHERE projectId=?)`).run(project.id);
      }

      // per-asset active window at this site (for one spanning assignment)
      const windows = new Map(); // assetId -> {firstY,firstMo,lastY,lastMo, code}

      for (const m of s.data.months) {
        const lastDay = lastDayOfMonth(m.year, m.month);
        for (const v of m.vehicles) {
          const a = resolve(v, project);
          // reconcile daily-sum vs the sheet's site-tank total
          if (v.siteTankTot != null) { (Math.abs(v.sumIssues - v.siteTankTot) <= 0.5 ? reconOk : reconBad).push({ site: s.siteName, sheet: m.sheet, code: a.code, daily: v.sumIssues, sheet_: v.siteTankTot }); }
          // fuel issues (one per day with litres)
          for (const it of v.issues) {
            const d = Math.min(it.day, lastDay);
            const dayIso = `${m.year}-${String(m.month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const price = priceFor(dayIso);
            if (APPLY) insFi.run(randomUUID(), "AUTO_DIESEL", it.litres, null, null, price.c, Math.round(it.litres * price.c), `${s.siteName} diesel sheet`, iso(m.year, m.month, d), now, a.id, ADMIN_ID, price.id, tank.id);
            stats.issues++; stats.litres += it.litres;
          }
          // meter readings (opening at day1, closing at month-end) when numeric
          if (v.openMeter != null) { if (APPLY) insMr.run(randomUUID(), v.openMeter, a.meter, iso(m.year, m.month, 1), "IMPORT", now, a.id, ADMIN_ID); stats.meterReadings++; }
          if (v.closeMeter != null) { if (APPLY) insMr.run(randomUUID(), v.closeMeter, a.meter, iso(m.year, m.month, lastDay, true), "IMPORT", now, a.id, ADMIN_ID); stats.meterReadings++; }
          // track window
          const w = windows.get(a.id) ?? { firstY: m.year, firstMo: m.month, lastY: m.year, lastMo: m.month, code: a.code };
          if (m.year < w.firstY || (m.year === w.firstY && m.month < w.firstMo)) { w.firstY = m.year; w.firstMo = m.month; }
          if (m.year > w.lastY || (m.year === w.lastY && m.month > w.lastMo)) { w.lastY = m.year; w.lastMo = m.month; }
          windows.set(a.id, w);
        }
        // receipts from the "Daily Fuel Purchase" footer
        for (const p of m.purchases) {
          const d = Math.min(p.day, lastDay);
          if (APPLY) insReq.run(randomUUID(), "AUTO_DIESEL", p.litres, "APPROVED", iso(m.year, m.month, d), iso(m.year, m.month, d), tank.id, ADMIN_ID, ADMIN_ID, iso(m.year, m.month, d), `${s.siteName} diesel sheet purchase`);
          stats.receipts++; stats.receiptLitres += p.litres;
        }
      }

      // one full-span assignment per asset at this site (standard site = full months)
      for (const [assetId, w] of windows) {
        const startIso = iso(w.firstY, w.firstMo, 1);
        const endIso = iso(w.lastY, w.lastMo, lastDayOfMonth(w.lastY, w.lastMo), true);
        if (APPLY) { insAsg.run(randomUUID(), assetId, project.id, startIso, endIso, `${s.siteName} diesel sheet`, now, now, ADMIN_ID); updPin.run(project.id, now, assetId); }
        stats.assignments++;
      }

      // tank balance from the last month's closing-balance footer
      const withClosing = [...s.data.months].reverse().find((m) => m.closingBalance != null);
      if (APPLY && withClosing) db.prepare(`UPDATE "BulkTank" SET balance=?, updatedAt=? WHERE id=?`).run(withClosing.closingBalance, now, tank.id);
    }

    if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN_ID, "CREATE", "System", ADMIN_ID, `Imported diesel sheets: Ambanpola + Inginimitiya (${stats.issues} issues, ${Math.round(stats.litres)} L, ${stats.assetsCreated} new assets)`, now);

    if (APPLY) db.exec("COMMIT");
  } catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

  // ---------- report ----------
  console.log(`\n=== DIESEL SHEET IMPORT ${APPLY ? "APPLIED" : "DRY-RUN"} ===\n`);
  console.log(`Reconcile daily-sum vs sheet site-tank total: ${reconOk.length} OK, ${reconBad.length} mismatch`);
  for (const b of reconBad.slice(0, 15)) console.log(`   MISMATCH ${b.site} ${b.sheet} ${b.code}: daily=${b.daily} vs sheet=${b.sheet_}`);
  console.log(`\nAssets: ${matchedList.length} matched to fleet, ${stats.assetsCreated} created`);
  if (matchedList.length) { console.log("Matched to existing fleet:"); for (const m of matchedList) console.log(`   ✓ sheet code="${m.sheetCode}" reg="${m.sheetReg}"  →  ${m.asset.padEnd(10)} (via ${m.via}) [${m.site}]`); }
  if (created.length) { console.log("Created assets:"); for (const c of created) console.log(`   + ${c.code.padEnd(14)} ${c.cat.padEnd(30)} ${c.meter.padEnd(5)} regNo=${c.regNo || "—"} [${c.site}]  (sheet: "${c.type}")`); }
  console.log(`\nFuel issues:   ${stats.issues}  (${Math.round(stats.litres)} L)`);
  console.log(`Meter reads:   ${stats.meterReadings}`);
  console.log(`Assignments:   ${stats.assignments}`);
  console.log(`Receipts:      ${stats.receipts}  (${Math.round(stats.receiptLitres)} L)`);
  if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write.`);
  db.close();
})();
