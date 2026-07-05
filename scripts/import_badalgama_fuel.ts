/**
 * Import the Badalgama Plant/Workshop daily fuel-issue matrices
 * (March / April / May 2026). Each row is a vehicle; columns 5..35 are the
 * litres issued on days 1..31. Real price = Rs 277/L (column 39).
 *
 * Attribution rule (per request): a vehicle's fuel COST follows the vehicle's
 * SITE. Because billing attributes fuel to a bill via the asset's project, we:
 *   - keep vehicles already assigned to a site on that site (their Badalgama
 *     fuel is billed to the site automatically);
 *   - assign matched-but-unassigned vehicles to the Badalgama project;
 *   - create unmatched workshop plant/equipment under the Badalgama project.
 * Every issue is stamped source="BADALGAMA" for provenance.
 *
 * Idempotent: clears all source="BADALGAMA" fuel issues before re-inserting.
 *
 * Run: npx tsx scripts/import_badalgama_fuel.ts
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
  { file: "128f30f0-BADALGAMA_PLANT_March_2026_1.xlsx", year: 2026, month: 3 },
  { file: "33df6f28-Badalgama_PlantApril2026_1.xlsx",   year: 2026, month: 4 },
  { file: "5a9e68ec-Badalgama_PlantMay2026_1.xlsx",     year: 2026, month: 5 },
];
const PRICE_CENTS = 27700; // Rs 277/L (from the sheets)

const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");
const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const dayDate = (y: number, m: number, d: number) => new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+05:30`);

function mapType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("compressor")) return "WSP";
  if (t.includes("generator") || t.includes("welding") || t.includes("asphalt") || t.includes("marine") || t.includes("engineering") || t.includes("bridge")) return "WSP";
  if (t.includes("boom")) return "BM";
  if (t.includes("double")) return "DC";
  if (t.includes("single")) return "SC";
  if (t.includes("crew") || t.includes("service")) return "HCC";
  if (t.includes("dump")) return "DT";
  if (t.includes("concrete") || t.includes("mixer")) return "TM";
  if (t.includes("excavator")) return "HEX";
  if (t.includes("jcb") || t.includes("backhoe")) return "LB";
  if (t.includes("grader") || t.includes("grador")) return "MG";
  if (t.includes("pneu") || t.includes("piemutic") || t.includes("t/rol")) return "PTR";
  if (t.includes("bed")) return "BD";
  if (t.includes("crain") || t.includes("crane")) return "CR";
  return "WSP";
}

type AssetInfo = { id: string; code: string };
const byCode = new Map<string, AssetInfo>();
const byReg = new Map<string, AssetInfo>();
const lookup = (s: string) => byCode.get(stripCode(s)) || byReg.get(stripCode(s));

const stats = { issues: 0, litres: 0, newAssets: 0, toBadal: 0, toSite: 0, cleared: 0 };

async function main() {
  console.log("Importing Badalgama workshop fuel (Mar–May 2026)…\n");
  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found");
  const sysId = sysUser.id;

  // Badalgama project + user + workshop-plant category
  const badal = await prisma.project.upsert({ where: { code: "BADAL" }, update: { name: "Badalgama Plant/Workshop" }, create: { name: "Badalgama Plant/Workshop", code: "BADAL" } });
  const username = "Badalgama Plant/Workshop";
  const existingUser = await prisma.user.findUnique({ where: { username } });
  const password = crypto.randomBytes(6).toString("base64url");
  await prisma.user.upsert({
    where: { username },
    update: { projectId: badal.id, name: `${username} Site User`, active: true },
    create: { username, name: `${username} Site User`, role: "USER", passwordHash: bcrypt.hashSync(password, 10), projectId: badal.id, createdById: sysId },
  });
  console.log(`Project "Badalgama Plant/Workshop" [BADAL] — user="${username}" ${existingUser ? "(password unchanged)" : `password="${password}" (generated once — record it now)`}`);
  await prisma.category.upsert({
    where: { code: "WSP" },
    update: {},
    create: { code: "WSP", name: "Workshop Plant / Equipment", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  });
  const wsp = await prisma.category.findUnique({ where: { code: "WSP" } });

  // Real price row
  const price = await prisma.fuelPrice.findFirst({
    where: { fuelKind: "AUTO_DIESEL", pricePerLitre: PRICE_CENTS },
    orderBy: { effectiveFrom: "desc" }
  });
  if (!price) {
    throw new Error(`Could not find a seeded AUTO_DIESEL price of Rs ${PRICE_CENTS / 100} in the database. Run import_fuel_prices first!`);
  }

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true } });
  for (const a of assets) { byCode.set(stripCode(a.code), a); if (a.regNo) byReg.set(stripCode(a.regNo), a); }

  // Idempotency
  stats.cleared = (await prisma.fuelIssue.deleteMany({ where: { source: "BADALGAMA" } })).count;

  const usedCodes = new Set<string>();
  for (const { file, year, month } of FILES) {
    const fp = path.join(UPLOADS, file);
    if (!fs.existsSync(fp)) { console.warn(`  ⚠ missing ${file}`); continue; }
    const wb = XLSX.readFile(fp, { cellDates: false });
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    const daysInMonth = new Date(year, month, 0).getDate();

    for (const row of raw.slice(6)) {
      const r = row as unknown[];
      const reg = String(r[1] || "").trim();
      if (!reg || !/^[A-Z0-9-]+$/i.test(reg)) continue;
      const type = String(r[3] || "Plant").trim() || "Plant";

      const badalVehicles = ["57-3062", "FL-03", "LO-9810", "28-4314"];
      const isBadalVehicle = badalVehicles.some(v => stripCode(v) === stripCode(reg));

      let asset = lookup(reg);
      if (!asset) {
        // Create under Badalgama if it is one of the 4 Badal vehicles, else create as unassigned
        let code = reg.toUpperCase();
        let base = code, n = 2;
        while (usedCodes.has(code) || byCode.has(stripCode(code))) code = `${base}#${n++}`;
        usedCodes.add(code);
        const catCode = mapType(type);
        const cat = (await prisma.category.findUnique({ where: { code: catCode } })) || wsp!;
        const created = await prisma.asset.create({
          data: { code, typeLabel: type, categoryId: cat.id, meterType: cat.defaultMeterType, status: "ACTIVE", projectId: isBadalVehicle ? badal.id : null },
        });
        asset = { id: created.id, code: created.code };
        byCode.set(stripCode(code), asset);
        stats.newAssets++;
        if (isBadalVehicle) stats.toBadal++; else stats.toSite++;
      } else {
        // Matched. If it's one of the 4 Badalgama vehicles, assign to Badalgama.
        // Otherwise, leave its project assignment completely untouched.
        if (isBadalVehicle) {
          await prisma.asset.update({ where: { id: asset.id }, data: { projectId: badal.id } });
          stats.toBadal++;
        } else {
          stats.toSite++;
        }
      }

      // Per-day fuel issues
      const issues: any[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const litres = toFloat(r[4 + d]); // day 1 at index 5
        if (litres <= 0) continue;
        issues.push({
          assetId: asset.id, fuelKind: "AUTO_DIESEL", litres,
          pricePerLitre: PRICE_CENTS, totalCost: Math.round(litres * PRICE_CENTS),
          issueDate: dayDate(year, month, d), source: "BADALGAMA", issuedById: sysId, fuelPriceId: price.id,
        });
        stats.litres += litres;
      }
      if (issues.length) { await prisma.fuelIssue.createMany({ data: issues }); stats.issues += issues.length; }
    }
    console.log(`  ✓ ${year}-${String(month).padStart(2, "0")} (${file.split("-").pop()})`);
  }

  await prisma.auditLog.create({
    data: { action: "IMPORT", entity: "FuelIssue", entityId: "bulk", summary: `Badalgama fuel: ${stats.issues} issues (${stats.litres.toFixed(0)} L) @ Rs ${PRICE_CENTS / 100}/L; ${stats.newAssets} new assets; ${stats.toSite} vehicle-months billed to their site; cleared ${stats.cleared} prior` },
  });

  console.log("\n── Summary ──────────────────────────────────");
  console.log(`  Cleared prior    : ${stats.cleared}`);
  console.log(`  Fuel issues      : ${stats.issues}  (${stats.litres.toFixed(0)} L @ Rs ${PRICE_CENTS / 100}/L)`);
  console.log(`  New assets       : ${stats.newAssets}`);
  console.log(`  Rows → site      : ${stats.toSite}`);
  console.log(`  Rows → Badalgama : ${stats.toBadal}`);
  console.log("────────────────────────────────────────────");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
