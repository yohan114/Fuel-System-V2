// Full data import from the Service Record system's SQLite database
// (service-record/data/service.db) into the merged system, so the entire
// service history is viewable. Imports the vehicle master as Assets (reusing
// existing assets by code, creating only what's missing) and every ServiceJob
// with its oils/filters/costs. Idempotent via ServiceRecord.sourceRef.
//
// Run: DATABASE_URL="file:./data/app.db" SERVICE_RECORD_DIR=/home/user/service-record \
//      npx tsx scripts/import_service_db.ts
import Database from "better-sqlite3";
import path from "path";
import { prisma } from "../src/lib/db";

// EC-prefix → category (mirrors prisma/seed.ts CATEGORY_MAP).
const CATEGORY_MAP: Record<string, { name: string; meterType: "KM" | "HOURS"; fleetGroup: "ROAD_VEHICLE" | "MACHINERY_GENSET" }> = {
  DT: { name: "Dump Truck", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  DC: { name: "Double Cab", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  SC: { name: "Single Cab", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  HCC: { name: "Crew Cab", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  TM: { name: "Truck Mixer", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BD: { name: "Bed Truck", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  DB: { name: "Dump Bowser", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  WB: { name: "Water Bowser", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BS: { name: "Bus", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  PV: { name: "Prime Mover", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BM: { name: "Boom Truck", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  MB: { name: "Motor Bicycle", meterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  LB: { name: "Backhoe Loader", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  LD: { name: "Wheel Loader", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  SL: { name: "Skid Steer Loader", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  MG: { name: "Motor Grader", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  HEX: { name: "Excavator", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  SR: { name: "Static Roller", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  VR: { name: "Vibrating Roller", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  PTR: { name: "Pneumatic Roller", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  AP: { name: "Asphalt Paver", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  CR: { name: "Mobile Crane", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  PC: { name: "Pump Truck", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  FL: { name: "Fork Lift", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  FT: { name: "Farm Tractor", meterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
};

const norm = (s: unknown) => (s || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
const toCents = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
const parseMeter = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) { const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function parseYom(v: unknown): number | null { const y = parseInt(String(v ?? "").trim(), 10); return Number.isFinite(y) && y > 1900 && y < 2100 ? y : null; }
const catCode = (ec: string) => { const m = norm(ec).match(/^[A-Z]+/); return m && CATEGORY_MAP[m[0]] ? m[0] : "OTHER"; };
const isEcLike = (s: string) => /^[A-Z]{1,4}-?\s?\d+/.test((s || "").trim().toUpperCase());

async function main() {
  const dir = process.env.SERVICE_RECORD_DIR || path.join(__dirname, "..", "..", "service-record");
  const sdb = new Database(path.join(dir, "data", "service.db"), { readonly: true });

  // Categories (ensure the prefix map + OTHER exist).
  const cats: Record<string, { id: string; meterType: "KM" | "HOURS" }> = {};
  for (const [code, d] of [...Object.entries(CATEGORY_MAP), ["OTHER", { name: "Other Asset", meterType: "KM", fleetGroup: "ROAD_VEHICLE" }] as const]) {
    const c = await prisma.category.upsert({
      where: { code },
      update: {},
      create: { code, name: d.name, defaultMeterType: d.meterType, fleetGroup: d.fleetGroup },
    });
    cats[code] = { id: c.id, meterType: d.meterType };
  }

  const user = (await prisma.user.findFirst({ where: { username: "admin" } })) || (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!user) throw new Error("No admin user — run the seed first.");

  // Existing assets (reuse, never overwrite).
  const codeToAsset = new Map<string, { id: string; meterType: string }>();
  for (const a of await prisma.asset.findMany({ select: { id: true, code: true, meterType: true } })) codeToAsset.set(norm(a.code), { id: a.id, meterType: a.meterType });

  let createdAssets = 0;
  async function createAsset(ec: string, extra: Record<string, unknown> = {}) {
    const cc = catCode(ec);
    const cat = cats[cc] ?? cats.OTHER;
    const a = await prisma.asset.create({ data: { code: ec.toUpperCase(), meterType: cat.meterType, categoryId: cat.id, ...extra } });
    const v = { id: a.id, meterType: cat.meterType };
    codeToAsset.set(norm(ec), v);
    createdAssets++;
    return v;
  }

  // 1) Vehicle master → assets (create only what's missing).
  const vehicles = sdb.prepare("SELECT VehicleID,ECNumber,Brand,VehicleType,ModelNo,RegistrationNo,Capacity,YearOfManufacture,SerialNo,ChassisNo,EngineNo,Site,Status FROM Vehicles").all() as any[];
  const vidToEc = new Map<number, string>();
  for (const v of vehicles) {
    const ec = (v.ECNumber || "").trim();
    if (ec) vidToEc.set(v.VehicleID, ec);
    if (!ec || codeToAsset.has(norm(ec))) continue;
    await createAsset(ec, {
      brand: v.Brand || null, typeLabel: v.VehicleType || null, model: v.ModelNo || null, regNo: v.RegistrationNo || null,
      capacity: v.Capacity || null, yom: parseYom(v.YearOfManufacture), serialNo: v.SerialNo || null, chassisNo: v.ChassisNo || null,
      engineNo: v.EngineNo || null, site: v.Site || null, status: String(v.Status || "").toUpperCase().includes("ACT") ? "ACTIVE" : "INACTIVE",
    });
  }
  const motos = sdb.prepare("SELECT ECNumber,Brand,VehicleType,ModelNo,RegistrationNo,Capacity,SerialNo,Site FROM Motorcycles").all() as any[];
  for (const m of motos) {
    const ec = (m.ECNumber || "").trim();
    if (!ec || codeToAsset.has(norm(ec))) continue;
    await createAsset(ec, { brand: m.Brand || null, typeLabel: m.VehicleType || null, model: m.ModelNo || null, regNo: m.RegistrationNo || null, capacity: m.Capacity || null, serialNo: m.SerialNo || null, site: m.Site || null });
  }

  // Fallback bucket for services whose vehicle can't be resolved.
  type AssetRef = { id: string; meterType: string };
  let unknownAsset: AssetRef | null = null;
  async function getUnknown(): Promise<AssetRef> {
    if (!unknownAsset) {
      unknownAsset = codeToAsset.get(norm("SVC-UNKNOWN")) ?? (await createAsset("SVC-UNKNOWN", { model: "Unmatched service history", status: "INACTIVE" }));
    }
    return unknownAsset;
  }

  async function resolveAsset(job: any): Promise<{ ref: AssetRef; fallback: boolean }> {
    let ec = (job.VehicleID != null && vidToEc.get(job.VehicleID)) || "";
    if (!ec) ec = String(job.VehicleLabel || "").split(/[·|]/)[0].trim().split(/\s+/)[0] || "";
    if (ec) {
      const hit = codeToAsset.get(norm(ec));
      if (hit) return { ref: hit, fallback: false };
      if (isEcLike(ec)) return { ref: await createAsset(ec), fallback: false };
    }
    return { ref: await getUnknown(), fallback: true };
  }

  // 2) Group children by ServiceID.
  const groupBy = <T extends { ServiceID: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) (m.get(r.ServiceID) ?? m.set(r.ServiceID, []).get(r.ServiceID)!).push(r);
    return m;
  };
  const oilsBy = groupBy(sdb.prepare("SELECT ServiceID,OilName,OilType,ActionType,Quantity,Price FROM ServiceOils").all() as any[]);
  const filtersBy = groupBy(sdb.prepare("SELECT ServiceID,FilterCategory,FilterNo,ActionType,Quantity,Price FROM ServiceFilters").all() as any[]);
  const costsBy = groupBy(sdb.prepare("SELECT ServiceID,CostDescription,Unit,Rate,Qty,Amount FROM ServiceCosts").all() as any[]);

  const existingRefs = new Set(
    (await prisma.serviceRecord.findMany({ where: { sourceRef: { not: null } }, select: { sourceRef: true } })).map((r) => r.sourceRef)
  );

  const jobs = sdb.prepare("SELECT * FROM ServiceJobs").all() as any[];
  const SENTINEL = new Date("1970-01-01T00:00:00Z"); // for rows with no date
  let created = 0, skipped = 0, unknownUsed = 0, noDate = 0;

  for (const j of jobs) {
    const ref = `servicedb:${j.ServiceID}`;
    if (existingRefs.has(ref)) { skipped++; continue; }
    const { ref: asset, fallback } = await resolveAsset(j);
    if (fallback) unknownUsed++;
    const date = parseDate(j.ServiceDate);
    if (!date) noDate++;

    const oils = (oilsBy.get(j.ServiceID) || [])
      .map((o) => ({ oilName: (o.OilName || "").trim() || "Oil", oilType: o.OilType || null, actionType: o.ActionType || null, quantity: Number(o.Quantity) || 0, priceCents: toCents(o.Price) }))
      .filter((o) => o.quantity > 0 || o.priceCents > 0 || o.oilType);
    const filters = (filtersBy.get(j.ServiceID) || [])
      .map((f) => ({ filterCategory: (f.FilterCategory || "").trim() || "Filter", filterNo: f.FilterNo || null, actionType: f.ActionType || null, quantity: Number(f.Quantity) || 1, priceCents: toCents(f.Price) }))
      .filter((f) => f.filterNo || f.priceCents > 0);
    const costLines = (costsBy.get(j.ServiceID) || [])
      .map((c) => ({ description: c.CostDescription || null, unit: c.Unit || null, rateCents: toCents(c.Rate), qty: Number(c.Qty) || 0, amountCents: toCents(c.Amount) }))
      .filter((c) => c.description || c.amountCents > 0);

    await prisma.serviceRecord.create({
      data: {
        assetId: asset.id,
        serviceDate: date || SENTINEL,
        meterType: asset.meterType,
        meterAtService: parseMeter(j.MeterReading),
        nextServiceMeter: parseMeter(j.NextServiceMeter),
        serviceType: j.ServiceType || null,
        jobNo: j.JobNo || null,
        siteLocation: j.SiteLocation || null,
        upkeepingStatus: j.UpkeepingStatus || null,
        repairDetails: j.RepairDetails || null,
        partsSubtotalCents: toCents(j.PartsSubtotal),
        labourRatePct: Number(j.LabourRate) || 0,
        labourChargeCents: toCents(j.LabourCharge),
        sundryRatePct: Number(j.SundryRate) || 0,
        sundryAmountCents: toCents(j.SundryAmount),
        grandTotalCents: toCents(j.GrandTotal),
        costCents: toCents(j.GrandTotal),
        note: "Imported from service.db",
        recordedById: user.id,
        sourceRef: ref,
        oils: oils.length ? { create: oils } : undefined,
        filters: filters.length ? { create: filters } : undefined,
        costLines: costLines.length ? { create: costLines } : undefined,
      },
    });
    created++;
    if (created % 250 === 0) console.log(`  …${created} services imported`);
  }

  const total = await prisma.serviceRecord.count();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const thisMonth = await prisma.serviceRecord.count({ where: { serviceDate: { gte: monthStart, lt: monthEnd } } });

  console.log(`\nAssets created: ${createdAssets}`);
  console.log(`Services imported: ${created} (skipped existing ${skipped}, unmatched→bucket ${unknownUsed}, no-date ${noDate})`);
  console.log(`Total services now: ${total}`);
  console.log(`This month (${monthStart.toISOString().slice(0, 7)}): ${thisMonth}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
