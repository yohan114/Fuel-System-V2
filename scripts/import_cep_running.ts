/**
 * Import the 5 monthly running timesheets (Jan–May 2026) for the Central
 * Expressway Project. For each workbook (one sheet per vehicle) this:
 *
 *   1. Reads the PROJECT name from the sheet header (row ~4, e.g.
 *      "Central Expressway Project [CEP-03]") and creates the Project.
 *   2. Creates a login USER per project — username = project name,
 *      password = username + "@123" (role USER, scoped to the project).
 *   3. Assigns every matched asset to that project.
 *   4. Imports day-by-day running:
 *        - DailyCondition WORKING for each active day
 *        - MeterReading START (col 2) + END (col 4)
 *   5. Issues per-day FUEL (col 11 = litres) attributed to the project,
 *      priced at the active AUTO_DIESEL price.
 *
 * Sheet layout: row 10 = headers; row 11+ = daily rows.
 *   col[1]=date "YYYY.MM.DD"  col[2]=start meter  col[4]=end meter
 *   col[6]=distance/hours      col[9]=hours worked col[11]=fuel litres
 *
 * Idempotent: clears DAILY_SHEET meter readings, working conditions, and fuel
 * issues for matched assets in the Jan–May 2026 window before re-inserting.
 *
 * Run: npx tsx scripts/import_cep_running.ts
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

const UPLOADS = process.env.UPLOADS_DIR || "/root/.claude/uploads/0e793a13-eb4c-5561-a4fd-d386f6b9819e";
const FILES = [
  { path: path.join(UPLOADS, "56342016-01_January_2026.xlsb"),  year: 2026, month: 1 },
  { path: path.join(UPLOADS, "45058aff-02_February_2026.xlsb"), year: 2026, month: 2 },
  { path: path.join(UPLOADS, "2d481ceb-03_March_2026.xlsb"),    year: 2026, month: 3 },
  { path: path.join(UPLOADS, "2ff1764f-04_April_2026.xlsb"),    year: 2026, month: 4 },
  { path: path.join(UPLOADS, "f4e0302f-05_May_2026.xlsb"),      year: 2026, month: 5 },
];

const WINDOW_START = new Date("2026-01-01T00:00:00+05:30");
const WINDOW_END   = new Date("2026-06-01T00:00:00+05:30"); // exclusive

const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");
function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00+05:30`);
}
const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const monthStartDate = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
function monthEndDate(y: number, m: number) {
  const d = new Date(y, m, 0);
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00+05:30`);
}

// Pull the project header line + bracketed code from the first rows of a sheet.
function readProject(rows: unknown[][]): { name: string; code: string } | null {
  for (let i = 0; i < 8; i++) {
    for (const c of (rows[i] || [])) {
      if (typeof c === "string" && /\[[^\]]+\]/.test(c) && /project|expressway|cep/i.test(c)) {
        const name = c.trim();
        const code = name.match(/\[([^\]]+)\]/)![1].trim().toUpperCase();
        return { name, code };
      }
    }
  }
  return null;
}

type AssetInfo = { id: string; code: string; meterType: string; category: { code: string } };
const assetByStripped = new Map<string, AssetInfo>();
const assetByReg = new Map<string, AssetInfo>();

const lookupAsset = (sheetName: string): AssetInfo | undefined =>
  assetByStripped.get(stripCode(sheetName)) || assetByReg.get(stripCode(sheetName));

const stats = {
  projects: 0, users: 0, assigned: 0,
  conditions: 0, readings: 0, issues: 0, litres: 0,
  delC: 0, delR: 0, delF: 0,
  unmatched: new Set<string>(),
};

async function main() {
  console.log("Importing CEP running timesheets (Jan–May 2026)…\n");

  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found — run seed first");
  const sysUserId = sysUser.id;

  // Asset lookup
  const assets = (await prisma.asset.findMany({
    select: {
      id: true,
      code: true,
      meterType: true,
      regNo: true,
      category: {
        select: { code: true }
      }
    }
  })) as any[];
  for (const a of assets) {
    assetByStripped.set(stripCode(a.code), a);
    if (a.regNo) assetByReg.set(stripCode(a.regNo), a);
  }
  console.log(`Loaded ${assets.length} assets.\n`);

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

  // ── Pass 1: discover project + which assets appear, and collect rows ──────────
  const projectCache = new Map<string, { id: string; name: string; code: string }>();
  const matchedAssetIds = new Set<string>();
  type Row = { date: Date; working: boolean; start: number; end: number; litres: number; meterType: string };
  const sheetData: { asset: AssetInfo; projectCode: string; rows: Row[]; year: number; month: number }[] = [];

  async function ensureProject(name: string, code: string) {
    if (projectCache.has(code)) return projectCache.get(code)!;
    const p = await prisma.project.upsert({
      where: { code },
      update: { name },
      create: { name, code },
    });
    projectCache.set(code, p);
    stats.projects++;

    // Login user: username = project name. Password is generated randomly on
    // first creation and printed once; re-imports never touch credentials.
    const username = name;
    const existingUser = await prisma.user.findUnique({ where: { username } });
    const password = crypto.randomBytes(6).toString("base64url");
    await prisma.user.upsert({
      where: { username },
      update: { projectId: p.id, name: `${name} Site User`, active: true },
      create: { username, name: `${name} Site User`, role: "USER", passwordHash: bcrypt.hashSync(password, 10), projectId: p.id, createdById: sysUserId },
    });
    stats.users++;
    console.log(`Project "${name}" [${code}] — user="${username}" ${existingUser ? "(password unchanged)" : `password="${password}" (generated once — record it now)`}`);
    return p;
  }

  const hourMeterTracker = new Map<string, number>();

  for (const file of FILES) {
    if (!fs.existsSync(file.path)) { console.warn(`  ⚠ missing ${file.path}`); continue; }
    const wb = XLSX.readFile(file.path, { cellDates: false });
    for (const sheetName of wb.SheetNames) {
      if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
      const asset = lookupAsset(sheetName);
      if (!asset) { stats.unmatched.add(sheetName); continue; }

      const proj = readProject(rows);
      if (!proj) { stats.unmatched.add(`${sheetName}(no-project)`); continue; }
      const p = await ensureProject(proj.name, proj.code);

      const meterType = asset.meterType === "KM" ? "KM" : "HOURS";
      const isOdometerAsset = asset.category.code === "BM" || asset.category.code === "PC";
      
      let currentHourMeter = hourMeterTracker.get(asset.id);
      if (isOdometerAsset && currentHourMeter === undefined) {
        for (const row of rows.slice(11)) {
          const r = row as unknown[];
          const startVal = toFloat(r[2]);
          if (startVal > 0) {
            currentHourMeter = startVal;
            break;
          }
        }
        if (currentHourMeter === undefined) {
          currentHourMeter = 0;
        }
      }

      const parsed: Row[] = [];
      for (const row of rows.slice(11)) {
        const r = row as unknown[];
        const date = parseDate(r[1]);
        if (!date) continue;
        const cs = date.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
        const [dy, dm] = cs.split("-").map(Number);
        if (dy !== file.year || dm !== file.month) continue;
        
        let start = toFloat(r[2]);
        let end = toFloat(r[4]);
        const distOrHrs = toFloat(r[6]);
        const hoursWkd = toFloat(r[9]);
        const litres = toFloat(r[11]);
        
        if (isOdometerAsset && currentHourMeter !== undefined) {
          const otHrs = toFloat(r[10]);
          const dailyWorkingHours = 1 + otHrs;
          if (distOrHrs > 0 || hoursWkd > 0 || litres > 0 || otHrs > 0) {
            start = currentHourMeter;
            end = currentHourMeter + dailyWorkingHours;
            currentHourMeter = end;
          } else {
            start = 0;
            end = 0;
          }
        }
        
        const working = isOdometerAsset
          ? (start > 0)
          : (distOrHrs > 0 || hoursWkd > 0 || litres > 0 || (start > 0 && end > start));
          
        parsed.push({ date, working, start, end, litres, meterType });
      }
      
      if (isOdometerAsset && currentHourMeter !== undefined) {
        hourMeterTracker.set(asset.id, currentHourMeter);
      }

      if (parsed.length) {
        matchedAssetIds.add(asset.id);
        sheetData.push({ asset, projectCode: p.code, rows: parsed, year: file.year, month: file.month });
        // Assign asset to project (last project wins; CEP is the only one here)
        await prisma.asset.update({ where: { id: asset.id }, data: { projectId: p.id } });
        stats.assigned++;

        // Create month-bounded AssetAssignment
        const startD = monthStartDate(file.year, file.month);
        const endD = monthEndDate(file.year, file.month);
        const existingAssign = await prisma.assetAssignment.findFirst({
          where: { assetId: asset.id, projectId: p.id, startDate: startD }
        });
        if (!existingAssign) {
          await prisma.assetAssignment.create({
            data: {
              assetId: asset.id,
              projectId: p.id,
              startDate: startD,
              endDate: endD,
              note: `CEP Running Sheet Import`
            }
          });
        }
      }
    }
  }

  // ── Clear existing data in window for matched assets (idempotency) ────────────
  const ids = [...matchedAssetIds];
  stats.delF = (await prisma.fuelIssue.deleteMany({ where: { assetId: { in: ids }, source: "CEP-03", issueDate: { gte: WINDOW_START, lt: WINDOW_END } } })).count;
  stats.delR = (await prisma.meterReading.deleteMany({ where: { assetId: { in: ids }, source: { in: ["DAILY_SHEET_START", "DAILY_SHEET_END"] }, readingDate: { gte: WINDOW_START, lt: WINDOW_END } } })).count;
  stats.delC = (await prisma.dailyCondition.deleteMany({ where: { assetId: { in: ids }, logDate: { gte: WINDOW_START, lt: WINDOW_END } } })).count;
  console.log(`\nCleared in window — fuel:${stats.delF} readings:${stats.delR} conditions:${stats.delC}\n`);

  // ── Pass 2: insert conditions, readings, fuel ────────────────────────────────
  for (const { asset, projectCode, rows } of sheetData) {
    const readings: any[] = [];
    for (const r of rows) {
      if (r.working) {
        await prisma.dailyCondition.create({
          data: { assetId: asset.id, logDate: r.date, status: "WORKING", recordedById: sysUserId },
        });
        stats.conditions++;
        if (r.start > 0) readings.push({ assetId: asset.id, readingType: r.meterType, value: r.start, readingDate: r.date, source: "DAILY_SHEET_START", recordedById: sysUserId });
        if (r.end > 0 && r.end !== r.start) readings.push({ assetId: asset.id, readingType: r.meterType, value: r.end, readingDate: r.date, source: "DAILY_SHEET_END", recordedById: sysUserId });
      }
      if (r.litres > 0) {
        const activePrice = getPriceForDate(r.date);
        await prisma.fuelIssue.create({
          data: {
            assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: r.litres,
            meterReading: r.end > 0 ? r.end : null, readingType: r.end > 0 ? r.meterType : null,
            pricePerLitre: activePrice.pricePerLitre, totalCost: Math.round(r.litres * activePrice.pricePerLitre),
            issueDate: r.date, source: projectCode, issuedById: sysUserId, fuelPriceId: activePrice.id,
          },
        });
        stats.issues++; stats.litres += r.litres;
      }
    }
    if (readings.length) { await prisma.meterReading.createMany({ data: readings }); stats.readings += readings.length; }
  }

  await prisma.auditLog.create({
    data: {
      action: "IMPORT", entity: "Project", entityId: "bulk",
      summary: `CEP running import: ${stats.projects} project(s), ${stats.users} user(s), ${stats.assigned} asset assignments, ${stats.conditions} conditions, ${stats.readings} readings, ${stats.issues} fuel issues (${stats.litres.toFixed(1)} L)`,
    },
  });

  console.log("── Summary ──────────────────────────────────");
  console.log(`  Projects created/updated : ${stats.projects}`);
  console.log(`  Site users               : ${stats.users}`);
  console.log(`  Asset → project links    : ${stats.assigned}`);
  console.log(`  Working conditions       : ${stats.conditions}`);
  console.log(`  Meter readings           : ${stats.readings}`);
  console.log(`  Fuel issues              : ${stats.issues}  (${stats.litres.toFixed(1)} L)`);
  if (stats.unmatched.size) console.log(`  Unmatched sheets (${stats.unmatched.size}): ${[...stats.unmatched].join(", ")}`);
  console.log("────────────────────────────────────────────");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
