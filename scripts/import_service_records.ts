import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { normalizePN, parseSupplierCode } from "../src/lib/filters/normalize";
import { OIL_SLOTS } from "../src/lib/service/sheet";

// One-off import of the standalone E&C Service Record System (SRDB,
// data/service.db) into this system: the oil & filter catalogues with prices,
// the filter cross-reference engine, and 1,579 historical service jobs with
// their oil/filter lines and PDF attachments.
//
// V2's ServiceRecord.sourceRef ("SRDB:<id>") was designed for exactly this, so
// the import is idempotent — a job already carrying its sourceRef is skipped.
// Historical costs are copied verbatim (LKR → cents), not recomputed, so old
// invoices reconcile to the cent regardless of today's labour/sundry rates.
//
// Dry-run by default; --apply writes (one deferred-FK transaction).
// --srdb=<path> and --attachments=<dir> override the defaults.

const APPLY = process.argv.includes("--apply");
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const SRDB_PATH = arg("srdb", "/tmp/claude-0/-home-user-Fuel-System-V2/ddd640e9-2dc1-5d1a-9875-08410003a7a4/scratchpad/upload2/servicerecord/data/service.db");
const ATTACH_DIR = arg("attachments", path.join(path.dirname(SRDB_PATH), "attachments"));

const srdb = new Database(SRDB_PATH, { readonly: true });
const v2 = new Database(path.join(process.cwd(), "data", "app.db"));

const cents = (lkr: number | null | undefined) => (lkr == null ? null : Math.round(Number(lkr) * 100));
const numOrNull = (s: unknown): number | null => {
  const n = parseFloat(String(s ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
};
const norm = (s: string | null | undefined) => (s || "").toUpperCase().replace(/[\s\-\/]/g, "");
const upAction = (s: string | null | undefined) => { const t = (s || "").trim().toUpperCase(); return t || null; };

// Map an OilPrices "Description" (which lists the slots a grade covers) to the
// fixed OIL_SLOTS of the service sheet.
const SLOT_KEYWORDS: [string, RegExp][] = [
  ["Engine Oil", /engine/i], ["Gear Box Oil", /gear\s*box|gearbox/i], ["Differential Oil", /differential/i],
  ["Transmission Oil", /transmission|transfer/i], ["Hydraulic Oil", /hydraulic/i], ["Torque Con. Oil", /torque/i],
  ["Power Steering Oil", /steering/i], ["Brake Oil", /brake/i], ["Swing Motor Oil", /swing/i],
  ["Travelling Motor Oil", /travel/i], ["Rear Axel Case Oil", /rear\s*ax[le]+/i], ["Front Axel Case Oil", /front\s*ax[le]+/i],
  ["Circle Gear Case Oil", /circle\s*gear/i], ["Tandem Drive Oil", /tandem/i], ["Compressor Oil", /compressor/i],
  ["Petrol & Kerosene Oil", /petrol|kerosene/i], ["Grease", /grease/i], ["Coolant", /coolant/i], ["Battery water", /battery/i],
];
function slotsFromDescription(desc: string): string[] {
  const hits = SLOT_KEYWORDS.filter(([, re]) => re.test(desc)).map(([slot]) => slot);
  return hits.length ? [...new Set(hits)] : [];
}

interface Stat { created: number; matched: number; skipped: number }
const stats: Record<string, Stat> = {};
const stat = (t: string): Stat => (stats[t] ??= { created: 0, matched: 0, skipped: 0 });
const notes: string[] = [];

v2.exec("BEGIN");
v2.pragma("defer_foreign_keys = ON");
try {
  const admin = v2.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get() as any;
  if (!admin) throw new Error("No ADMIN user to attribute imported records to");
  const now = new Date().toISOString();

  // ---- 1. Lubricants (oils with prices) --------------------------------------
  // One priced grade → one Lubricant per oil-type slot it serves, so the
  // service form's Type dropdown offers it on every relevant row.
  {
    const insert = v2.prepare(`INSERT INTO "Lubricant" (id,name,oilType,unit,pricePerUnitCents,note,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,?,?)`);
    const seen = new Set((v2.prepare("SELECT name, oilType FROM Lubricant").all() as any[]).map((r) => `${r.name}|${r.oilType ?? ""}`));
    for (const op of srdb.prepare("SELECT OilTypeCode, Description, UnitPriceLKR FROM OilPrices").all() as any[]) {
      const name = String(op.OilTypeCode || "").trim();
      if (!name) continue;
      const price = cents(op.UnitPriceLKR);
      const unit = /grease/i.test(name + " " + op.Description) ? "kg" : "L";
      const slots = slotsFromDescription(String(op.Description || ""));
      const targets = slots.length ? slots : [null];
      for (const slot of targets) {
        const key = `${name}|${slot ?? ""}`;
        if (seen.has(key)) { stat("Lubricant").matched++; continue; }
        seen.add(key);
        if (APPLY) insert.run(randomUUID(), name, slot, unit, price, op.Description || null, now, now);
        stat("Lubricant").created++;
      }
    }
  }

  // ---- 2. Filters + prices + cross-references --------------------------------
  const filterIdMap = new Map<number, string>(); // SRDB FilterID → V2 Filter id
  {
    // price map: normalized part code → { cents, supplier }
    const priceByPN = new Map<string, { cents: number; supplier: string | null }>();
    for (const r of srdb.prepare("SELECT SupplierFilterCode, UnitPriceLKR FROM FilterPrices WHERE UnitPriceLKR > 0").all() as any[]) {
      const { code, supplier } = parseSupplierCode(String(r.SupplierFilterCode || ""));
      const k = normalizePN(code);
      if (k && !priceByPN.has(k)) priceByPN.set(k, { cents: cents(r.UnitPriceLKR)!, supplier });
    }
    for (const r of srdb.prepare("SELECT HIFIEquivalent, GenuineBrand, SourcingPriceInclVAT FROM GenuinePrices WHERE SourcingPriceInclVAT > 0").all() as any[]) {
      const k = normalizePN(String(r.HIFIEquivalent || ""));
      if (k && !priceByPN.has(k)) priceByPN.set(k, { cents: cents(r.SourcingPriceInclVAT)!, supplier: r.GenuineBrand || null });
    }

    const insertF = v2.prepare(`INSERT INTO "Filter" (id,category,oemPartNo,hifiPartNo,description,priceCents,priceNote,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`);
    const insertX = v2.prepare(`INSERT INTO "FilterCrossRef" (id,filterId,brand,partNumber,normalizedPN,refType) VALUES (?,?,?,?,?,?)`);
    const already = new Set((v2.prepare("SELECT category, hifiPartNo, oemPartNo FROM Filter").all() as any[]).map((r) => `${r.category ?? ""}|${r.hifiPartNo ?? ""}|${r.oemPartNo ?? ""}`));

    for (const f of srdb.prepare("SELECT * FROM Filters").all() as any[]) {
      const hifi = String(f.HIFIPartNumber || "").trim() || null;
      const oem = String(f.OEMPartNumber || "").trim() || null;
      const cat = String(f.FilterCategory || "").trim() || null;
      const key = `${cat ?? ""}|${hifi ?? ""}|${oem ?? ""}`;
      if (already.has(key)) { stat("Filter").matched++; continue; }
      already.add(key);
      const p = priceByPN.get(norm(hifi)) ?? priceByPN.get(norm(oem)) ?? null;
      const id = randomUUID();
      filterIdMap.set(f.FilterID, id);
      if (APPLY) insertF.run(id, cat, oem, hifi, f.Description || null, p?.cents ?? null, p?.supplier ?? null, now, now);
      stat("Filter").created++;
      if (p) stat("Filter").skipped++; // reuse skipped as "priced" counter
    }

    for (const x of srdb.prepare("SELECT * FROM FilterCrossRefs").all() as any[]) {
      const fid = filterIdMap.get(x.FilterID);
      if (!fid) { stat("FilterCrossRef").skipped++; continue; }
      const pn = String(x.PartNumber || "").trim();
      if (!pn) { stat("FilterCrossRef").skipped++; continue; }
      if (APPLY) insertX.run(randomUUID(), fid, x.Brand || null, pn, x.NormalizedPN || normalizePN(pn), x.RefType || null);
      stat("FilterCrossRef").created++;
    }
  }

  // ---- 3. Vehicle resolution (+ create missing generators) -------------------
  const assetByCode = new Map<string, string>();
  for (const a of v2.prepare("SELECT id, code, regNo FROM Asset").all() as any[]) {
    assetByCode.set(norm(a.code), a.id);
  }
  const assetByReg = new Map<string, string>();
  for (const a of v2.prepare("SELECT id, regNo FROM Asset WHERE regNo IS NOT NULL AND regNo != ''").all() as any[]) {
    assetByReg.set(norm(a.regNo), a.id);
  }
  // Some legacy jobs have a null VehicleID but carry the code in VehicleLabel
  // ("VR-059 CC1250", "RG-3189 ( FT-14 )", "ZA-2609(LB01)"). Resolve those
  // against asset codes, tolerating leading zeros (VR-059 → VR-59) and a
  // parenthesised real code.
  const stripZero = (k: string) => k.replace(/([A-Z]+)0*(\d+)/, "$1$2");
  const assetByAnyCode = new Map<string, string>();
  for (const a of v2.prepare("SELECT id, code FROM Asset").all() as any[]) {
    const n = norm(a.code);
    assetByAnyCode.set(n, a.id);
    assetByAnyCode.set(stripZero(n), a.id);
  }
  function resolveLabel(label: string): string | null {
    const lbl = String(label || "").trim();
    if (!lbl) return null;
    const cands: string[] = [];
    const paren = lbl.match(/\(\s*([A-Za-z]{1,4}[- ]?\d+)\s*\)/);
    if (paren) cands.push(paren[1]);
    cands.push(lbl.split(/[\s·|(]/)[0], lbl);
    for (const c of cands) {
      const n = norm(c);
      if (assetByAnyCode.has(n)) return assetByAnyCode.get(n)!;
      if (assetByAnyCode.has(stripZero(n))) return assetByAnyCode.get(stripZero(n))!;
    }
    return null;
  }

  const vehToAsset = new Map<number, string>(); // SRDB VehicleID → V2 asset id
  {
    // Ensure a Generator category exists for the GE-* units.
    let genCat = (v2.prepare("SELECT id FROM Category WHERE code='GE' OR name='Generator' LIMIT 1").get() as any)?.id;
    const otherCat = (v2.prepare("SELECT id FROM Category WHERE code='OTHER' OR name LIKE '%Other%' LIMIT 1").get() as any)?.id;
    const insA = v2.prepare(`INSERT INTO "Asset" (id,code,brand,typeLabel,model,regNo,capacity,yom,serialNo,chassisNo,engineNo,site,status,meterType,createdAt,updatedAt,categoryId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    for (const v of srdb.prepare("SELECT * FROM Vehicles").all() as any[]) {
      const code = String(v.ECNumber || "").trim();
      if (code && assetByCode.has(norm(code))) { vehToAsset.set(v.VehicleID, assetByCode.get(norm(code))!); stat("Vehicle").matched++; continue; }
      // Blank EC → match on registration, which may be stored as either an
      // asset's regNo or its code (e.g. the 57-3062 Double Cab is coded 57-3062).
      if (!code && v.RegistrationNo) {
        const byReg = assetByReg.get(norm(v.RegistrationNo)) ?? assetByCode.get(norm(v.RegistrationNo));
        if (byReg) { vehToAsset.set(v.VehicleID, byReg); stat("Vehicle").matched++; continue; }
      }
      if (!code) { stat("Vehicle").skipped++; notes.push(`vehicle w/o EC or matchable reg: "${v.RegistrationNo}" — its services skipped`); continue; }

      // Create the missing unit (the GE-* generators). Generators run on hours.
      const isGen = /generator/i.test(`${v.EquipmentDescription} ${v.VehicleType}`);
      const catId = isGen ? (genCat ?? otherCat) : otherCat;
      if (!catId) { stat("Vehicle").skipped++; notes.push(`no category to create ${code}`); continue; }
      if (isGen && !genCat) {
        genCat = randomUUID();
        if (APPLY) v2.prepare(`INSERT INTO "Category" (id,code,name,defaultMeterType,fleetGroup) VALUES (?,?,?,?,?)`).run(genCat, "GE", "Generator", "HOURS", "MACHINERY_GENSET");
        stat("Category").created++;
      }
      const id = randomUUID();
      if (APPLY) insA.run(id, code, v.Brand || null, v.VehicleType || null, v.ModelNo || null, v.RegistrationNo || null,
        v.Capacity || null, numOrNull(v.YearOfManufacture), v.SerialNo || null, v.ChassisNo || null, v.EngineNo || null,
        v.Site || null, "ACTIVE", isGen ? "HOURS" : "KM", now, now, isGen ? (genCat as string) : catId);
      assetByCode.set(norm(code), id);
      vehToAsset.set(v.VehicleID, id);
      stat("Vehicle").created++;
    }
  }

  // ---- 4. Service jobs + oil/filter lines + attachments ----------------------
  {
    const existingSrc = new Set((v2.prepare("SELECT sourceRef FROM ServiceRecord WHERE sourceRef IS NOT NULL").all() as any[]).map((r) => r.sourceRef));
    const meterTypeOf = new Map((v2.prepare("SELECT id, meterType FROM Asset").all() as any[]).map((a) => [a.id, a.meterType]));
    const insRec = v2.prepare(`INSERT INTO "ServiceRecord" (id,assetId,serviceDate,meterAtService,meterType,serviceType,costCents,note,jobNo,partsCents,labourCents,sundryCents,manpowerCents,location,nextServiceMeter,condition,sourceRef,recordedById,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insItem = v2.prepare(`INSERT INTO "ServiceItem" (id,serviceRecordId,kind,description,partNo,action,qty,unitPriceCents,amountCents) VALUES (?,?,?,?,?,?,?,?,?)`);
    const insAtt = v2.prepare(`INSERT INTO "ServiceAttachment" (id,serviceRecordId,fileName,mimeType,data,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?)`);
    const oilsByJob = groupBy(srdb.prepare("SELECT * FROM ServiceOils").all() as any[], (r) => r.ServiceID);
    const filtsByJob = groupBy(srdb.prepare("SELECT * FROM ServiceFilters").all() as any[], (r) => r.ServiceID);
    const attByJob = groupBy(srdb.prepare("SELECT * FROM ServiceAttachments").all() as any[], (r) => r.ServiceID);

    let labelResolved = 0;
    for (const j of srdb.prepare("SELECT * FROM ServiceJobs").all() as any[]) {
      const sourceRef = `SRDB:${j.ServiceID}`;
      if (existingSrc.has(sourceRef)) { stat("ServiceRecord").matched++; continue; }
      let assetId = j.VehicleID != null ? vehToAsset.get(j.VehicleID) : undefined;
      if (!assetId) {
        const byLabel = resolveLabel(j.VehicleLabel);
        if (byLabel) { assetId = byLabel; labelResolved++; }
      }
      if (!assetId) { stat("ServiceRecord").skipped++; notes.push(`unresolved vehicle "${String(j.VehicleLabel || "").slice(0, 24)}" on SRDB:${j.ServiceID}`); continue; }
      // A handful of legacy jobs have no ServiceDate — fall back to when the
      // record was created rather than dropping the service entirely.
      let date = new Date(String(j.ServiceDate || "").slice(0, 10) + "T00:00:00Z");
      if (isNaN(date.getTime())) date = new Date(String(j.CreatedAt || "").replace(" ", "T"));
      if (isNaN(date.getTime())) { stat("ServiceRecord").skipped++; notes.push(`no usable date on SRDB:${j.ServiceID}`); continue; }

      const recId = randomUUID();
      if (APPLY) insRec.run(recId, assetId, date.toISOString(), numOrNull(j.MeterReading), meterTypeOf.get(assetId) || "HOURS",
        j.ServiceType || null, cents(j.GrandTotal) ?? 0, j.RepairDetails ? String(j.RepairDetails).trim() || null : null, String(j.JobNo || "").trim() || null,
        cents(j.PartsSubtotal) ?? 0, cents(j.LabourCharge) ?? 0, cents(j.SundryAmount) ?? 0, 0,
        String(j.SiteLocation || "").trim() || null, numOrNull(j.NextServiceMeter),
        j.UpkeepingStatus === "Good" ? "G" : j.UpkeepingStatus === "Fair" ? "F" : j.UpkeepingStatus === "Bad" ? "B" : null,
        sourceRef, admin.id, now);
      stat("ServiceRecord").created++;

      for (const o of oilsByJob.get(j.ServiceID) ?? []) {
        const amt = cents(o.Price) ?? 0;
        const qty = Number(o.Quantity) || 0;
        if (APPLY) insItem.run(randomUUID(), recId, "OIL", String(o.OilName || "Oil"), o.OilType ? String(o.OilType).trim() || null : null, upAction(o.ActionType), qty, qty > 0 && amt > 0 ? Math.round(amt / qty) : null, amt);
        stat("ServiceItem").created++;
      }
      for (const f of filtsByJob.get(j.ServiceID) ?? []) {
        const amt = cents(f.Price) ?? 0;
        const qty = Number(f.Quantity) || 1;
        if (APPLY) insItem.run(randomUUID(), recId, "FILTER", String(f.FilterCategory || "Filter"), f.FilterNo ? String(f.FilterNo).trim() || null : null, upAction(f.ActionType), qty, qty > 0 && amt > 0 ? Math.round(amt / qty) : null, amt);
        stat("ServiceItem").created++;
      }
      for (const a of attByJob.get(j.ServiceID) ?? []) {
        const file = path.join(ATTACH_DIR, String(a.StoredName));
        if (!fs.existsSync(file)) { stat("ServiceAttachment").skipped++; notes.push(`missing attachment file ${a.StoredName}`); continue; }
        const data = fs.readFileSync(file);
        if (APPLY) insAtt.run(randomUUID(), recId, a.OriginalName || a.StoredName, a.MimeType || "application/octet-stream", data, admin.id, now);
        stat("ServiceAttachment").created++;
      }
    }
    if (labelResolved) console.log(`  (recovered ${labelResolved} services with a null VehicleID via their VehicleLabel)`);
  }

  if (APPLY) v2.exec("COMMIT"); else v2.exec("ROLLBACK");
} catch (err) {
  v2.exec("ROLLBACK");
  throw err;
}

console.log(`=== SERVICE-RECORD IMPORT ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} — SRDB → data/app.db ===`);
for (const [t, s] of Object.entries(stats)) {
  const extra = t === "Filter" ? `  (of which priced ${s.skipped})` : "";
  console.log(`  ${t.padEnd(17)} created ${String(s.created).padStart(5)}  matched ${String(s.matched).padStart(5)}  skipped ${String(t === "Filter" ? 0 : s.skipped).padStart(4)}${extra}`);
}
if (notes.length) { console.log(`\n  ${notes.length} note(s):`); for (const n of [...new Set(notes)].slice(0, 8)) console.log(`   · ${n}`); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");

srdb.close();
v2.close();

function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}
