/**
 * Import the three monthly-SUMMARY site workbooks:
 *   - Gampaha Bridge   (code GB)   — machines_Vehicles_at_Gampaha_Bridge__2.xlsb
 *   - Inginimitiya     (code INGI) — Inginimitiya_Vehicle_Machinery_summary.xlsx
 *   - Karativu Bridge  (code KB)   — machines_cost_Karativu_Bridge__1.xlsb
 *
 * Each workbook has one sheet per month; each row is a vehicle's MONTHLY total
 * (not day-by-day). Column positions differ between sites, so headers are read
 * by name (row index 2). Per row we use: Vehicle No, Type, "Actual working
 * days/machine hours", and Fuel (litres).
 *
 * For each site this:
 *   1. Creates the Project + a login user (username = project name,
 *      password = username + "@123").
 *   2. Matches each vehicle to an asset by E&C code or reg no; creates the
 *      asset (mapped to a category by type) if missing, and assigns it to the
 *      project.
 *   3. Creates ONE monthly FuelIssue per vehicle (source = project code,
 *      dated the last day of the month).
 *   4. For HOURS-metered machinery, records the month's machine-hours as a
 *      cumulative MeterReading pair (SUMMARY_START/END) so rental is billable.
 *      KM/per-day vehicles get fuel only (no day-by-day data in summaries).
 *
 * Imports every month present (2025 + 2026). Idempotent: clears this import's
 * own SUMMARY fuel issues + readings for the touched assets before re-inserting.
 *
 * Fuel price: Rs 350/L placeholder (Ceypetco blocks automation).
 *
 * Run: npx tsx scripts/import_site_summaries.ts
 */
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
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

const UPLOADS = process.env.UPLOADS_DIR || "/root/.claude/uploads/0e793a13-eb4c-5561-a4fd-d386f6b9819e";
const SITES: { code: string; name: string; files: string[] }[] = [
  { code: "GB",   name: "Gampaha Bridge",  files: ["05d37c9a-machines_Vehicles_at_Gampaha_Bridge__2.xlsb"] },
  { code: "INGI", name: "Inginimitiya",    files: ["5c29a0f0-Inginimitiya_Vehicle_Machinery_summary.xlsx"] },
  { code: "KB",   name: "Karativu Bridge", files: ["4ded3264-machines_cost_Karativu_Bridge__1.xlsb"] },
  { code: "BATTI", name: "ICDP Batti Lot-03", files: [
    "dd9fd7f5-Batti_ICDP_LOT03_January.xlsx",
    "71a0583e-Batti_ICDP_LOT03_September_2025.xlsx",
    "7cd63ca6-Batti_ICDP_LOT03_October_2025.xlsx",
    "b7247401-Batti_ICDP_LOT03_November_2025.xlsx",
    "165a019a-Batti_ICDP_LOT03_December_2025.xlsx",
  ] },
];

const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");
const monthStartDate = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
function monthEndDate(y: number, m: number) {
  const d = new Date(y, m, 0);
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00+05:30`);
}
const MONTHS: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
function parseSheetMonth(name: string) {
  const p = name.trim().toLowerCase().split(/\s+/);
  const month = MONTHS[p[0]]; const year = parseInt(p[1]);
  return month && !isNaN(year) ? { year, month } : null;
}
// Some workbooks have the wrong month/year typed in the tab + title (copy-paste
// leftovers). When the file is named per-month, the filename is authoritative.
function parseFileMonth(filename: string): { month?: number; year?: number } {
  const lower = filename.toLowerCase();
  let month: number | undefined;
  for (const [name, num] of Object.entries(MONTHS)) if (lower.includes(name)) { month = num; break; }
  const ym = filename.match(/(20\d{2})/);
  let year = ym ? parseInt(ym[1]) : undefined;
  if (filename.includes("Batti_ICDP_LOT03_January")) {
    year = 2026;
  }
  return { month, year };
}

// Map a free-text vehicle type to one of the rebuilt category codes.
function mapTypeToCategory(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("excavator") || /\b\d{2,3}\b/.test(t) && t.includes("ex")) return "HEX";
  if (t.includes("excavator")) return "HEX";
  if (t.includes("backhoe")) return "LB";
  if (t.includes("skid")) return "SL";
  if (t.includes("wheel")) return "LD";
  if (t.includes("roller") || t.includes("compactor")) return "VR";
  if (t.includes("grader")) return "MG";
  if (t.includes("crane")) return "CR";
  if (t.includes("boom")) return "BM";
  if (t.includes("tipper") || t.includes("dump")) return "DT";
  if (t.includes("mixer")) return "TM";
  if (t.includes("forklift")) return "FL";
  if (t.includes("diesel bowser")) return "DB";
  if (t.includes("water bowser")) return "WB";
  if (t.includes("bowser") || t.includes("tanker")) return "DB";
  if (t.includes("crew")) return "HCC";
  if (t.includes("double")) return "DC";
  if (t.includes("single")) return "SC";
  if (t.includes("van")) return "PV";
  if (t.includes("tractor")) return "FT";
  if (/\b(230|330|220|120|60)\b/.test(t)) return "HEX"; // bare tonnage = excavator
  return "HEX";
}

// Locate columns by header name (handles both layouts).
function detectColumns(header: unknown[]) {
  const find = (pred: (s: string) => boolean) =>
    header.findIndex((c) => typeof c === "string" && pred(c.toLowerCase()));
  // Prefer the ACTUAL usage column; fall back to any days/machine-hours column.
  let units = find((s) => s.includes("actual") && (s.includes("working") || s.includes("days") || s.includes("hours")));
  if (units < 0) units = find((s) => s.includes("machine hours") || s.includes("days/machine"));
  return {
    veh: find((s) => s.includes("vehicle no")) >= 0 ? find((s) => s.includes("vehicle no")) : 1,
    type: find((s) => s === "type") >= 0 ? find((s) => s === "type") : 2,
    units,
    dist: find((s) => s.includes("distance")),
    fuel: find((s) => s.trim() === "fuel"),
    rate: find((s) => s.includes("rate")),
  };
}

type AssetInfo = { id: string; code: string; meterType: string };
const byCode = new Map<string, AssetInfo>();
const byReg = new Map<string, AssetInfo>();
const lookup = (code: string) => byCode.get(stripCode(code)) || byReg.get(stripCode(code));

const stats = { projects: 0, users: 0, newAssets: 0, assigned: 0, fuel: 0, litres: 0, readings: 0, skipped: new Set<string>() };

async function main() {
  console.log("Importing site summary workbooks (GB / INGI / KB)…\n");
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

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true, regNo: true } });
  for (const a of assets) { byCode.set(stripCode(a.code), a); if (a.regNo) byReg.set(stripCode(a.regNo), a); }

  // Idempotency: remove this import's own prior records before re-inserting
  const codes = SITES.map((s) => s.code);
  await prisma.fuelIssue.deleteMany({ where: { source: { in: codes } } });
  await prisma.meterReading.deleteMany({ where: { source: { in: ["SUMMARY_START", "SUMMARY_END"] } } });

  async function ensureAsset(code: string, type: string, projectId: string, rateVal?: number): Promise<AssetInfo> {
    const found = lookup(code);
    if (found) {
      await prisma.asset.update({ where: { id: found.id }, data: { projectId } });
      stats.assigned++;
      
      // Ensure the existing asset has a rate card if we have a parsed rate
      const currentRate = await prisma.rentalRate.findUnique({ where: { assetId: found.id } });
      if (!currentRate && rateVal && rateVal > 0) {
        const catCode = mapTypeToCategory(type);
        await prisma.rentalRate.create({
          data: {
            assetId: found.id,
            equipType: "FLEET",
            category: catCode,
            sourceLabel: `Site summary dynamic rate for ${found.code}`,
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
      data: { code: code.toUpperCase(), typeLabel: type, categoryId: cat.id, meterType: cat.defaultMeterType, status: "ACTIVE", projectId },
    });
    
    // Create a dynamic rate card for the new asset if a rate was specified in the sheet
    if (rateVal && rateVal > 0) {
      await prisma.rentalRate.create({
        data: {
          assetId: a.id,
          equipType: "FLEET",
          category: catCode,
          sourceLabel: `Site summary dynamic rate for ${a.code}`,
          ...(cat.defaultMeterType === "KM"
            ? { kmWCents: Math.round(rateVal * 100), kmFwCents: Math.round(rateVal * 100) }
            : { hrWCents: Math.round(rateVal * 100), hrFwCents: Math.round(rateVal * 100) }
          )
        }
      });
    }
    
    const info = { id: a.id, code: a.code, meterType: a.meterType };
    byCode.set(stripCode(a.code), info);
    stats.newAssets++; stats.assigned++;
    return info;
  }

  for (const site of SITES) {
    const present = site.files.filter((f) => fs.existsSync(path.join(UPLOADS, f)));
    if (present.length === 0) { console.warn(`  ⚠ no files for ${site.name}`); continue; }

    const project = await prisma.project.upsert({ where: { code: site.code }, update: { name: site.name }, create: { name: site.name, code: site.code } });
    stats.projects++;
    const username = site.name;
    const password = `${username}@123`;
    await prisma.user.upsert({
      where: { username },
      update: { passwordHash: bcrypt.hashSync(password, 10), projectId: project.id, name: `${site.name} Site User`, active: true },
      create: { username, name: `${site.name} Site User`, role: "USER", passwordHash: bcrypt.hashSync(password, 10), projectId: project.id, createdById: sysId },
    });
    stats.users++;
    console.log(`\n── ${site.name} [${site.code}] — user="${username}" password="${password}"`);

    // Gather every monthly sheet across all of the site's workbooks, sorted
    // chronologically so cumulative hour readings line up.
    const sheets: { rows: unknown[][]; period: { year: number; month: number } }[] = [];
    for (const f of present) {
      const wb = XLSX.readFile(path.join(UPLOADS, f), { cellDates: false });
      const fm = parseFileMonth(f); // filename month/year overrides a mislabeled tab
      for (const sn of wb.SheetNames) {
        const sheetP = parseSheetMonth(sn);
        const month = fm.month ?? sheetP?.month;
        const year = fm.year ?? sheetP?.year;
        if (!month || !year) continue;
        sheets.push({ rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" }), period: { year, month } });
      }
    }
    sheets.sort((a, b) => (a.period.year - b.period.year) || (a.period.month - b.period.month));

    const cumHours = new Map<string, number>(); // assetId → cumulative machine-hours
    const cumKms = new Map<string, number>(); // assetId → cumulative kilometers
    const touched = new Set<string>();

    for (const { rows, period } of sheets) {
      const cols = detectColumns(rows[2] || []);
      const { year, month } = period;

      for (const row of rows.slice(3)) {
        const r = row as unknown[];
        // Stop at the "External Vehicles" sub-section (bill-amount only, no fuel)
        if (r.some((c) => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) break;
        const rawCode = String(r[cols.veh] || "").trim();
        if (!rawCode || !/^[A-Z0-9-]+$/i.test(rawCode)) continue;
        const type = String(r[cols.type] || "Vehicle").trim() || "Vehicle";
        const units = cols.units >= 0 ? toFloat(r[cols.units]) : 0;
        const distVal = cols.dist >= 0 ? toFloat(r[cols.dist]) : 0;
        const litres = cols.fuel >= 0 ? toFloat(r[cols.fuel]) : 0;
        if (litres < 0 || units < 0 || distVal < 0) continue;

        const rateVal = cols.rate >= 0 ? toFloat(r[cols.rate]) : 0;
        const asset = await ensureAsset(rawCode, type, project.id, rateVal);
        touched.add(asset.id);

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
              note: `Site Summary Import`
            }
          });
        }

        // Monthly fuel issue (always created to record the vehicle's presence, even with 0 L)
        const issueDate = monthEndDate(year, month);
        const activePrice = getPriceForDate(issueDate);
        await prisma.fuelIssue.create({
          data: {
            assetId: asset.id, fuelKind: "AUTO_DIESEL", litres,
            pricePerLitre: activePrice.pricePerLitre, totalCost: Math.round(litres * activePrice.pricePerLitre),
            issueDate, source: site.code, issuedById: sysId, fuelPriceId: activePrice.id,
          },
        });
        stats.fuel++; stats.litres += litres;

        // Machine-hours → cumulative HOURS readings (rental basis) for HOURS assets
        if (units >= 0 && asset.meterType === "HOURS") {
          const startVal = cumHours.get(asset.id) || 0;
          const endVal = startVal + units;
          cumHours.set(asset.id, endVal);
          await prisma.meterReading.createMany({
            data: [
              { assetId: asset.id, readingType: "HOURS", value: startVal, readingDate: monthStartDate(year, month), source: `SUMMARY_${site.code}_START`, recordedById: sysId },
              { assetId: asset.id, readingType: "HOURS", value: endVal, readingDate: monthEndDate(year, month), source: `SUMMARY_${site.code}_END`, recordedById: sysId },
            ],
          });
          stats.readings += 2;
        }

        // Distance → cumulative KM readings (rental basis) for KM assets
        if (distVal >= 0 && asset.meterType === "KM") {
          const startVal = cumKms.get(asset.id) || 0;
          const endVal = startVal + distVal;
          cumKms.set(asset.id, endVal);
          await prisma.meterReading.createMany({
            data: [
              { assetId: asset.id, readingType: "KM", value: startVal, readingDate: monthStartDate(year, month), source: `SUMMARY_${site.code}_START`, recordedById: sysId },
              { assetId: asset.id, readingType: "KM", value: endVal, readingDate: monthEndDate(year, month), source: `SUMMARY_${site.code}_END`, recordedById: sysId },
            ],
          });
          stats.readings += 2;
        }
      }
      console.log(`   ✓ ${year}-${String(month).padStart(2, "0")}`);
    }
  }

  await prisma.auditLog.create({
    data: { action: "IMPORT", entity: "Project", entityId: "bulk", summary: `Site summaries: ${stats.projects} projects, ${stats.users} users, ${stats.newAssets} new assets, ${stats.assigned} assignments, ${stats.fuel} fuel issues (${stats.litres.toFixed(0)} L), ${stats.readings} readings` },
  });

  console.log("\n── Summary ──────────────────────────────────");
  console.log(`  Projects        : ${stats.projects}`);
  console.log(`  Site users      : ${stats.users}`);
  console.log(`  New assets       : ${stats.newAssets}`);
  console.log(`  Asset→project    : ${stats.assigned}`);
  console.log(`  Fuel issues      : ${stats.fuel}  (${stats.litres.toFixed(0)} L)`);
  console.log(`  Hours readings   : ${stats.readings}`);
  console.log("────────────────────────────────────────────");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
