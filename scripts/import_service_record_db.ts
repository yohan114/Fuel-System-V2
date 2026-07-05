/**
 * Merge the E&C Service Record System's database into this app.
 *
 * Source: service-record-data.db (committed copy of that system's SQLite file;
 * override with SR_DB=path). Brings across:
 *
 *   Filters + FilterCrossRefs → Filter / FilterCrossRef  (cross-reference engine)
 *   FilterPrices + GenuinePrices → Filter.priceCents      (resolved through the
 *       cross-refs — price codes are supplier codes like "C115 (VIC Japan)")
 *   VehicleFilters → AssetFilter                          (which filters fit which machine,
 *       matched to assets by E&C number; unmatched keep their original label)
 *   ServiceJobs + ServiceOils + ServiceFilters → ServiceRecord (+ ServiceItem)
 *       with job no, labour/sundry breakdown and per-part lines; idempotent via
 *       sourceRef = "SRDB:<ServiceID>" so re-imports update instead of duplicate
 *       and manually logged records are never touched.
 *
 * Filter/cross-ref/link tables are rebuilt from the source on every run.
 */
import fs from "fs";
import path from "path";
import BetterSqlite3 from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { normalizePN, parseSupplierCode } from "../src/lib/filters/normalize";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const SRC = process.env.SR_DB || path.join(process.cwd(), "service-record-data.db");

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Service-record database not found at ${SRC}`);
    process.exit(1);
  }
  const src = new BetterSqlite3(SRC, { readonly: true });
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No admin user found");

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true } });
  const assetByCode = new Map(assets.map((a) => [a.code.toUpperCase(), a]));

  // ── Filters + cross-refs (rebuilt from source) ────────────────────────────
  await prisma.filter.deleteMany({}); // cascades cross-refs and asset links
  const srcFilters = src.prepare("SELECT * FROM Filters").all() as any[];
  const filterIdMap = new Map<number, string>();
  for (const f of srcFilters) {
    const created = await prisma.filter.create({
      data: {
        category: f.FilterCategory || null,
        oemPartNo: f.OEMPartNumber || null,
        hifiPartNo: f.HIFIPartNumber || null,
        description: f.Description || null,
      },
    });
    filterIdMap.set(f.FilterID, created.id);
  }

  const srcXrefs = src.prepare("SELECT * FROM FilterCrossRefs").all() as any[];
  const xrefRows = srcXrefs
    .filter((x) => filterIdMap.has(x.FilterID) && String(x.PartNumber || "").trim())
    .map((x) => ({
      filterId: filterIdMap.get(x.FilterID)!,
      brand: x.Brand || null,
      partNumber: String(x.PartNumber).trim(),
      normalizedPN: x.NormalizedPN ? String(x.NormalizedPN) : normalizePN(String(x.PartNumber)),
      refType: x.RefType || null,
    }));
  await prisma.filterCrossRef.createMany({ data: xrefRows });

  // Resolve prices through the cross-refs (lowest quote wins).
  const norm2filter = new Map<string, Set<string>>();
  const addKey = (k: string, id: string) => {
    if (!k) return;
    (norm2filter.get(k) ?? norm2filter.set(k, new Set()).get(k)!).add(id);
  };
  for (const x of xrefRows) addKey(x.normalizedPN, x.filterId);
  for (const f of srcFilters) {
    const id = filterIdMap.get(f.FilterID)!;
    addKey(normalizePN(f.OEMPartNumber), id);
    addKey(normalizePN(f.HIFIPartNumber), id);
  }
  const best = new Map<string, { cents: number; note: string }>();
  const offer = (filterId: string, cents: number, note: string) => {
    const cur = best.get(filterId);
    if (!cur || cents < cur.cents) best.set(filterId, { cents, note });
  };
  let priceRowsMatched = 0;
  for (const p of src.prepare("SELECT * FROM FilterPrices").all() as any[]) {
    const { code, supplier } = parseSupplierCode(String(p.SupplierFilterCode || ""));
    const hits = norm2filter.get(normalizePN(code));
    const cents = Math.round(Number(p.UnitPriceLKR) * 100);
    if (!hits || !isFinite(cents) || cents <= 0) continue;
    priceRowsMatched++;
    for (const fid of hits) offer(fid, cents, supplier || "supplier quote");
  }
  for (const g of src.prepare("SELECT * FROM GenuinePrices").all() as any[]) {
    const hits = norm2filter.get(normalizePN(String(g.HIFIEquivalent || "")));
    const cents = Math.round(Number(g.SourcingPriceInclVAT) * 100);
    if (!hits || !isFinite(cents) || cents <= 0) continue;
    for (const fid of hits) {
      if (!best.has(fid)) best.set(fid, { cents, note: `${g.GenuineBrand || "Genuine"} (genuine)` });
    }
  }
  for (const [filterId, b] of best) {
    await prisma.filter.update({ where: { id: filterId }, data: { priceCents: b.cents, priceNote: b.note } });
  }

  // ── Machine ↔ filter links ────────────────────────────────────────────────
  const srcVF = src.prepare("SELECT * FROM VehicleFilters").all() as any[];
  const seen = new Set<string>();
  const linkRows: { filterId: string; assetId: string | null; vehicleRef: string }[] = [];
  let linksMatched = 0;
  for (const vf of srcVF) {
    const filterId = filterIdMap.get(vf.FilterID);
    if (!filterId) continue;
    const asset = assetByCode.get(String(vf.MatchedECNumber || "").toUpperCase().trim());
    const vehicleRef = String(vf.VehicleReference || vf.MatchedECNumber || "").trim() || "—";
    const key = `${filterId}|${asset?.id ?? vehicleRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (asset) linksMatched++;
    linkRows.push({ filterId, assetId: asset?.id ?? null, vehicleRef });
  }
  await prisma.assetFilter.createMany({ data: linkRows });

  // ── Service history (idempotent by sourceRef) ─────────────────────────────
  const jobs = src
    .prepare("SELECT j.*, v.ECNumber FROM ServiceJobs j JOIN Vehicles v ON v.VehicleID = j.VehicleID")
    .all() as any[];
  const oilsByJob = new Map<number, any[]>();
  for (const o of src.prepare("SELECT * FROM ServiceOils").all() as any[]) {
    (oilsByJob.get(o.ServiceID) ?? oilsByJob.set(o.ServiceID, []).get(o.ServiceID)!).push(o);
  }
  const filtersByJob = new Map<number, any[]>();
  for (const f of src.prepare("SELECT * FROM ServiceFilters").all() as any[]) {
    (filtersByJob.get(f.ServiceID) ?? filtersByJob.set(f.ServiceID, []).get(f.ServiceID)!).push(f);
  }

  const cents = (v: unknown): number | null => {
    const n = Number(v);
    return isFinite(n) && n !== 0 ? Math.round(n * 100) : null;
  };
  let jobsCreated = 0;
  let jobsUpdated = 0;
  let jobsSkipped = 0;
  for (const j of jobs) {
    const asset = assetByCode.get(String(j.ECNumber || "").toUpperCase().trim());
    if (!asset) {
      jobsSkipped++;
      continue;
    }
    const serviceDate = new Date(`${j.ServiceDate}T00:00:00`);
    if (isNaN(serviceDate.getTime())) {
      jobsSkipped++;
      continue;
    }
    const meter = parseFloat(String(j.MeterReading));
    const data = {
      assetId: asset.id,
      serviceDate,
      meterAtService: isFinite(meter) && meter > 0 ? meter : null,
      meterType: asset.meterType,
      serviceType: String(j.ServiceType || "").trim() || null,
      costCents: cents(j.GrandTotal),
      note: String(j.RepairDetails || "").trim() || null,
      jobNo: String(j.JobNo || "").trim() || null,
      partsCents: cents(j.PartsSubtotal),
      labourCents: cents(j.LabourCharge),
      sundryCents: cents(j.SundryAmount),
    };
    const sourceRef = `SRDB:${j.ServiceID}`;
    const existing = await prisma.serviceRecord.findUnique({ where: { sourceRef } });
    let recordId: string;
    if (existing) {
      await prisma.serviceRecord.update({ where: { id: existing.id }, data });
      await prisma.serviceItem.deleteMany({ where: { serviceRecordId: existing.id } });
      recordId = existing.id;
      jobsUpdated++;
    } else {
      const rec = await prisma.serviceRecord.create({ data: { ...data, sourceRef, recordedById: admin.id } });
      recordId = rec.id;
      jobsCreated++;
    }
    const items = [
      ...(oilsByJob.get(j.ServiceID) ?? []).map((o: any) => ({
        serviceRecordId: recordId,
        kind: "OIL",
        description: [o.OilName, o.OilType].filter(Boolean).join(" ") || "Oil",
        partNo: null as string | null,
        action: o.ActionType || null,
        qty: Number(o.Quantity) || 1,
        unitPriceCents: cents(o.Price),
        amountCents: cents((Number(o.Price) || 0) * (Number(o.Quantity) || 1)),
      })),
      ...(filtersByJob.get(j.ServiceID) ?? []).map((f: any) => ({
        serviceRecordId: recordId,
        kind: "FILTER",
        description: f.FilterCategory || "Filter",
        partNo: String(f.FilterNo || "").trim() || null,
        action: f.ActionType || null,
        qty: Number(f.Quantity) || 1,
        unitPriceCents: cents(f.Price),
        amountCents: cents((Number(f.Price) || 0) * (Number(f.Quantity) || 1)),
      })),
    ];
    if (items.length > 0) await prisma.serviceItem.createMany({ data: items });
  }

  console.log("── Service-record system merge ──────────────");
  console.log(`  Filters:            ${srcFilters.length} (with a resolved price: ${best.size}; matched price rows: ${priceRowsMatched})`);
  console.log(`  Cross-references:   ${xrefRows.length}`);
  console.log(`  Machine↔filter:     ${linkRows.length} (matched to assets: ${linksMatched})`);
  console.log(`  Service jobs:       created ${jobsCreated}, updated ${jobsUpdated}, skipped ${jobsSkipped} (no matching vehicle)`);
  console.log(`  Service line items: ${await prisma.serviceItem.count()}`);
  src.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
