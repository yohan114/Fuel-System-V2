/**
 * Import CEP-03 ABC Package monthly summaries (Jan-Mar 2026)
 *
 * For each spreadsheet (January, February, March 2026):
 *   1. Creates/Updates Project CEP-03-ABC (Name: CEP-03 A,B & C Package)
 *   2. Creates/Updates login User "CEP-03 A,B & C Package" with password "CEP-03 A,B & C Package@123"
 *   3. Matches each vehicle to an asset by code or regNo.
 *   4. Re-assigns asset to project CEP-03-ABC.
 *   5. Clears prior daily/running or summary fuel issues, conditions, and meter readings
 *      for these assets during the Jan-Mar 2026 window to prevent double-billing.
 *   6. Inserts monthly fuel issue (AUTO_DIESEL, priced at the month's effective rate).
 *   7. Records cumulative MeterReadings for HOURS and KM assets to support correct billing.
 *
 * Idempotent: clears prior entries in the target window for processed assets before inserting.
 *
 * Run: npx tsx scripts/import_cep_abc.ts
 */
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const FILES = [
  { name: "CEP-03 A,B and C - January 2026.xlsx", year: 2026, month: 1 },
  { name: "CEP-03 A,B and C - February 2026.xlsx", year: 2026, month: 2 },
  { name: "CEP-03 A,B and C - March 2026.xlsx", year: 2026, month: 3 }
];

const WINDOW_START = new Date("2026-01-01T00:00:00+05:30");
const WINDOW_END   = new Date("2026-04-01T00:00:00+05:30"); // exclusive (covers Jan, Feb, Mar)

const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");
const monthStartDate = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
function monthEndDate(y: number, m: number) {
  const d = new Date(y, m, 0);
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00+05:30`);
}

function mapTypeToCategory(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("excavator") || /\b\d{2,3}\b/.test(t) && t.includes("ex")) return "HEX";
  if (t.includes("backhoe")) return "LB";
  if (t.includes("skid")) return "SL";
  if (t.includes("wheel")) return "LD";
  if (t.includes("roller") || t.includes("compactor")) return "VR";
  if (t.includes("grader")) return "MG";
  if (t.includes("crane")) return "CR";
  if (t.includes("boom")) return "BM";
  if (t.includes("tipper") || t.includes("dump") || t.includes("cube")) return "DT";
  if (t.includes("mixer")) return "TM";
  if (t.includes("forklift")) return "FL";
  if (t.includes("diesel bowser")) return "DB";
  if (t.includes("water bowser")) return "WB";
  if (t.includes("bowser") || t.includes("tanker")) return "DB";
  if (t.includes("crew")) return "HCC";
  if (t.includes("double")) return "DC";
  if (t.includes("single") || t.includes("s/cab")) return "SC";
  if (t.includes("van")) return "PV";
  if (t.includes("tractor")) return "FT";
  if (t.includes("pump")) return "CR";
  return "HEX";
}

function detectColumns(header: unknown[]) {
  const find = (pred: (s: string) => boolean) =>
    header.findIndex((c) => typeof c === "string" && pred(c.toLowerCase()));
  
  let units = find((s) => s.includes("actual") && (s.includes("working") || s.includes("days") || s.includes("hours")));
  if (units < 0) units = find((s) => s.includes("machine hours") || s.includes("days/machine"));

  let rateIdx = find((s) => s.includes("rate hour") || s.includes("rate /day") || s.includes("rate/day"));
  if (rateIdx < 0) rateIdx = find((s) => s.trim() === "rate");

  return {
    veh: find((s) => s.includes("vehicle no")) >= 0 ? find((s) => s.includes("vehicle no")) : 1,
    type: find((s) => s === "type") >= 0 ? find((s) => s === "type") : 2,
    units,
    dist: find((s) => s.includes("distance")),
    fuel: find((s) => s.trim() === "fuel" || s.toLowerCase() === "fuel"),
    rate: rateIdx
  };
}

type AssetInfo = { id: string; code: string; meterType: string };
const byCode = new Map<string, AssetInfo>();
const byReg = new Map<string, AssetInfo>();
const lookup = (code: string) => byCode.get(stripCode(code)) || byReg.get(stripCode(code));

const stats = { projects: 0, users: 0, newAssets: 0, assigned: 0, fuel: 0, litres: 0, readings: 0 };

async function main() {
  console.log("Importing CEP-03 ABC Project Package Summaries (Jan-Mar 2026)…\n");
  
  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found");
  const sysId = sysUser.id;

  // Pre-load all AUTO_DIESEL prices for dynamic lookup
  const allPrices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" },
    orderBy: { effectiveFrom: "asc" },
  });
  if (allPrices.length === 0) {
    throw new Error("No fuel prices found in database. Run import_fuel_prices first!");
  }
  function getPriceForDate(date: Date) {
    let selected = allPrices[0];
    for (const p of allPrices) {
      if (p.effectiveFrom <= date) {
        selected = p;
      } else {
        break;
      }
    }
    return selected;
  }

  // Populate maps for quick lookup
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true, regNo: true } });
  for (const a of assets) {
    byCode.set(stripCode(a.code), a);
    if (a.regNo) byReg.set(stripCode(a.regNo), a);
  }

  const projectCode = "CEP-03-ABC";
  const projectName = "CEP-03 A,B & C Package";

  // Create Project
  const project = await prisma.project.upsert({
    where: { code: projectCode },
    update: { name: projectName },
    create: { name: projectName, code: projectCode }
  });
  stats.projects++;

  // Create Site User. Password is generated randomly on first creation and
  // printed once; re-imports never touch credentials.
  const username = projectName;
  const existingUser = await prisma.user.findUnique({ where: { username } });
  const password = crypto.randomBytes(6).toString("base64url");
  await prisma.user.upsert({
    where: { username },
    update: { projectId: project.id, name: `${projectName} Site User`, active: true },
    create: { username, name: `${projectName} Site User`, role: "USER", passwordHash: bcrypt.hashSync(password, 10), projectId: project.id, createdById: sysId }
  });
  stats.users++;

  console.log(`Project: "${projectName}" [${projectCode}] | User: "${username}" ${existingUser ? "(password unchanged)" : `/ "${password}" (generated once — record it now)`}`);

  async function ensureAsset(code: string, type: string, projectId: string, rateVal?: number): Promise<AssetInfo> {
    const found = lookup(code);
    if (found) {
      await prisma.asset.update({ where: { id: found.id }, data: { projectId } });
      stats.assigned++;

      // Ensure the existing asset has a rate card if missing and rate is provided
      const currentRate = await prisma.rentalRate.findUnique({ where: { assetId: found.id } });
      if (!currentRate && rateVal && rateVal > 0) {
        const catCode = mapTypeToCategory(type);
        await prisma.rentalRate.create({
          data: {
            assetId: found.id,
            equipType: "FLEET",
            category: catCode,
            sourceLabel: `CEP-03-ABC summary dynamic rate for ${found.code}`,
            ...(found.meterType === "KM"
              ? { kmWCents: Math.round(rateVal * 100), kmFwCents: Math.round(rateVal * 100) }
              : { hrWCents: Math.round(rateVal * 100), hrFwCents: Math.round(rateVal * 100) }
            )
          }
        });
      }
      return found;
    }

    const catCode = mapTypeToCategory(type);
    const cat = await prisma.category.findUnique({ where: { code: catCode } });
    if (!cat) throw new Error(`Category not found: ${catCode}`);

    const a = await prisma.asset.create({
      data: {
        code: code.toUpperCase(),
        typeLabel: type,
        categoryId: cat.id,
        meterType: cat.defaultMeterType,
        status: "ACTIVE",
        projectId
      }
    });

    if (rateVal && rateVal > 0) {
      await prisma.rentalRate.create({
        data: {
          assetId: a.id,
          equipType: "FLEET",
          category: catCode,
          sourceLabel: `CEP-03-ABC summary dynamic rate for ${a.code}`,
          ...(cat.defaultMeterType === "KM"
            ? { kmWCents: Math.round(rateVal * 100), kmFwCents: Math.round(rateVal * 100) }
            : { hrWCents: Math.round(rateVal * 100), hrFwCents: Math.round(rateVal * 100) }
          )
        }
      });
    }

    const info = { id: a.id, code: a.code, meterType: a.meterType };
    byCode.set(stripCode(a.code), info);
    stats.newAssets++;
    stats.assigned++;
    return info;
  }

  // ── PASS 1: Read sheets, resolve assets, and collect data ───────────────────
  const processedAssets = new Set<string>();
  
  interface ParsedRow {
    asset: AssetInfo;
    year: number;
    month: number;
    units: number;
    distVal: number;
    litres: number;
  }
  const rowsToInsert: ParsedRow[] = [];

  for (const fileInfo of FILES) {
    const filePath = path.join(process.cwd(), fileInfo.name);
    if (!fs.existsSync(filePath)) {
      console.warn(`File ${fileInfo.name} not found!`);
      continue;
    }
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

    const headerRowIdx = 2;
    const cols = detectColumns(rows[headerRowIdx] || []);

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      if (!row || row.length === 0) continue;

      // Stop at External Vehicle section
      if (row.some(c => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) {
        break;
      }

      const rawCode = String(row[cols.veh] || "").trim();
      if (!rawCode || !/^[A-Z0-9-]+$/i.test(rawCode) || rawCode.toLowerCase().includes("running") || rawCode.toLowerCase() === "vehicle no") {
        continue;
      }

      const type = String(row[cols.type] || "Vehicle").trim();
      const units = cols.units >= 0 ? toFloat(row[cols.units]) : 0;
      const distVal = cols.dist >= 0 ? toFloat(row[cols.dist]) : 0;
      const litres = cols.fuel >= 0 ? toFloat(row[cols.fuel]) : 0;
      const rateVal = cols.rate >= 0 ? toFloat(row[cols.rate]) : 0;

      const asset = await ensureAsset(rawCode, type, project.id, rateVal);
      processedAssets.add(asset.id);

      rowsToInsert.push({
        asset,
        year: fileInfo.year,
        month: fileInfo.month,
        units,
        distVal,
        litres
      });
    }
  }

  // ── PASS 2: Perform Bulk Cleanup for the target assets in Jan-Mar 2026 ──────
  const assetIds = Array.from(processedAssets);
  console.log(`Cleaning database for ${assetIds.length} target assets in window Jan-Mar 2026…`);

  const delF = await prisma.fuelIssue.deleteMany({
    where: { assetId: { in: assetIds }, source: projectCode, issueDate: { gte: WINDOW_START, lt: WINDOW_END } }
  });
  const delR = await prisma.meterReading.deleteMany({
    where: { assetId: { in: assetIds }, source: { in: [`${projectCode}_START`, `${projectCode}_END`] }, readingDate: { gte: WINDOW_START, lt: WINDOW_END } }
  });

  console.log(`  Cleared summary records: fuelIssues=${delF.count}, meterReadings=${delR.count}`);

  // ── PASS 3: Insert monthly summaries data ──────────────────────────────────
  const cumHours = new Map<string, number>();
  const cumKms = new Map<string, number>();

  // Ensure chronological order
  rowsToInsert.sort((a, b) => (a.year - b.year) || (a.month - b.month));

  for (const row of rowsToInsert) {
    const { asset, year, month, units, distVal, litres } = row;

    // Monthly fuel issue (always created to record the vehicle's presence, even with 0 L)
    const issueDate = monthEndDate(year, month);
    const activePrice = getPriceForDate(issueDate);
    await prisma.fuelIssue.create({
      data: {
        assetId: asset.id,
        fuelKind: "AUTO_DIESEL",
        litres,
        pricePerLitre: activePrice.pricePerLitre,
        totalCost: Math.round(litres * activePrice.pricePerLitre),
        issueDate,
        source: projectCode,
        issuedById: sysId,
        fuelPriceId: activePrice.id
      }
    });
    stats.fuel++;
    stats.litres += litres;

    // Create month-bounded AssetAssignment
    const startD = monthStartDate(year, month);
    const endD = monthEndDate(year, month);
    const existingAssign = await prisma.assetAssignment.findFirst({
      where: { assetId: asset.id, projectId: project.id, startDate: startD }
    });
    if (!existingAssign) {
      await prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          projectId: project.id,
          startDate: startD,
          endDate: endD,
          note: `CEP-03-ABC Summary Import`
        }
      });
    }

    // Record cumulative meter readings (always created, even if units is 0, to preserve continuity)
    if (asset.meterType === "HOURS" && units >= 0) {
      const startVal = cumHours.get(asset.id) || 0;
      const endVal = startVal + units;
      cumHours.set(asset.id, endVal);
      await prisma.meterReading.createMany({
        data: [
          { assetId: asset.id, readingType: "HOURS", value: startVal, readingDate: monthStartDate(year, month), source: `${projectCode}_START`, recordedById: sysId },
          { assetId: asset.id, readingType: "HOURS", value: endVal, readingDate: monthEndDate(year, month), source: `${projectCode}_END`, recordedById: sysId }
        ]
      });
      stats.readings += 2;
    }

    if (asset.meterType === "KM" && distVal >= 0) {
      const startVal = cumKms.get(asset.id) || 0;
      const endVal = startVal + distVal;
      cumKms.set(asset.id, endVal);
      await prisma.meterReading.createMany({
        data: [
          { assetId: asset.id, readingType: "KM", value: startVal, readingDate: monthStartDate(year, month), source: `${projectCode}_START`, recordedById: sysId },
          { assetId: asset.id, readingType: "KM", value: endVal, readingDate: monthEndDate(year, month), source: `${projectCode}_END`, recordedById: sysId }
        ]
      });
      stats.readings += 2;
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "IMPORT",
      entity: "Project",
      entityId: projectCode,
      summary: `CEP-03 ABC package: ${stats.projects} projects, ${stats.users} users, ${stats.newAssets} new assets, ${stats.assigned} assignments, ${stats.fuel} fuel issues (${stats.litres.toFixed(0)} L), ${stats.readings} readings`
    }
  });

  console.log("\n── Import Summary ───────────────────────────");
  console.log(`  Project Upserted: ${stats.projects}`);
  console.log(`  User Upserted   : ${stats.users}`);
  console.log(`  New Assets      : ${stats.newAssets}`);
  console.log(`  Assets Assigned : ${stats.assigned}`);
  console.log(`  Fuel Issues     : ${stats.fuel} (${stats.litres.toFixed(0)} L)`);
  console.log(`  Meter Readings  : ${stats.readings}`);
  console.log("─────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("Import failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
