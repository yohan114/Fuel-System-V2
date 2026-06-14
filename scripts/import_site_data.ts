import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    }
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

const files = [
  { path: "d:/Yohan/Fuel System/BADALGAMA PLANT -March -2026.xlsx", sheet: "March-2026", month: 3 },
  { path: "d:/Yohan/Fuel System/Badalgama Plant-April-2026.xlsx", sheet: "APRIL-2026", month: 4 },
  { path: "d:/Yohan/Fuel System/Badalgama Plant-May-2026.xlsx", sheet: "MAY-2026", month: 5 }
];

// Mapping sheet site names to project details
const SITE_PROJECTS = [
  { rawName: "head office", name: "Head Office", code: "HO" },
  { rawName: "mallawagedara", name: "Mallawagedara Bridge", code: "MLB" },
  { rawName: "marawila site", name: "Marawila Road Site", code: "MRS" },
  { rawName: "ecto", name: "ECTO Engineering", code: "ECT" },
  { rawName: "wadakada", name: "Wadakada CEP-3", code: "WCP" },
  { rawName: "mundalam estate", name: "Mundalam Estate", code: "MDE" },
  { rawName: "mrs.charithas estate", name: "Mrs. Charitha's Estate", code: "MCE" },
  { rawName: "badalgama w/s", name: "Badalgama Plant", code: "BGP" }
];

async function main() {
  console.log("Starting site historical data import...");

  // 1. Resolve operator Chamila
  const chamilaUser = await prisma.user.findUnique({
    where: { username: "chamila" }
  });
  if (!chamilaUser || !chamilaUser.bulkTankId) {
    console.error("Error: User 'chamila' or linked bulk tank not found.");
    process.exit(1);
  }
  const mainPumpId = chamilaUser.bulkTankId;
  const mainPump = await prisma.bulkTank.findUnique({ where: { id: mainPumpId } });
  const mainPumpName = mainPump ? mainPump.name : "Badalgama Main Workshop Main pump";

  // 2. Resolve default category 'OTHER'
  let otherCategory = await prisma.category.findUnique({
    where: { code: "OTHER" },
  });
  if (!otherCategory) {
    otherCategory = await prisma.category.create({
      data: {
        code: "OTHER",
        name: "Other Asset",
        defaultMeterType: "KM",
        fleetGroup: "ROAD_VEHICLE",
      },
    });
  }

  // 3. Resolve or create Projects, and create site assets
  const projectMap: Record<string, string> = {}; // rawName -> projectId
  const assetMap: Record<string, any> = {}; // rawName -> asset

  for (const s of SITE_PROJECTS) {
    let proj = await prisma.project.findUnique({
      where: { code: s.code }
    });
    if (!proj) {
      proj = await prisma.project.create({
        data: { name: s.name, code: s.code }
      });
      console.log(`Created project "${s.name}" (${s.code})`);
    }
    projectMap[s.rawName] = proj.id;

    // Create a special asset corresponding to this site
    const assetCode = `SITE-${s.code}`;
    let asset = await prisma.asset.findUnique({
      where: { code: assetCode }
    });
    if (!asset) {
      asset = await prisma.asset.create({
        data: {
          code: assetCode,
          regNo: assetCode,
          categoryId: otherCategory.id,
          projectId: proj.id,
          meterType: "KM",
          status: "ACTIVE",
          brand: "Site Storage",
          typeLabel: "Project Site",
        }
      });
      console.log(`Created site asset "${assetCode}" linked to project "${proj.name}"`);
    }
    assetMap[s.rawName] = asset;
  }

  let totalImported = 0;
  let totalSkipped = 0;

  for (const f of files) {
    if (!fs.existsSync(f.path)) {
      console.log(`File not found: ${f.path}`);
      continue;
    }
    console.log(`Processing ${path.basename(f.path)}...`);

    const workbook = XLSX.readFile(f.path);
    const sheet = workbook.Sheets[f.sheet];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

    for (let i = 6; i <= 153; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;

      const rawRegNo = row[1];
      if (!rawRegNo) continue;

      const cleanReg = String(rawRegNo).trim().toLowerCase();
      // Check if this row is one of our target sites
      const siteDetails = SITE_PROJECTS.find(s => s.rawName === cleanReg || cleanReg.startsWith(s.rawName));
      if (!siteDetails) continue;

      const asset = assetMap[siteDetails.rawName];

      // Loop days 1 to 31
      for (let day = 1; day <= 31; day++) {
        const value = row[4 + day]; // day 1 is index 5
        if (typeof value === "number" && value > 0) {
          const dayStr = String(day).padStart(2, "0");
          const monthStr = String(f.month).padStart(2, "0");
          const issueDate = new Date(`2026-${monthStr}-${dayStr}T08:00:00.000Z`);

          // Resolve fuel price
          const fuelPrice = await prisma.fuelPrice.findFirst({
            where: {
              fuelKind: "AUTO_DIESEL",
              effectiveFrom: { lte: issueDate }
            },
            orderBy: { effectiveFrom: "desc" }
          });

          if (!fuelPrice) {
            throw new Error(`Price not found for date ${issueDate.toISOString()}`);
          }

          // Idempotency check
          const existing = await prisma.fuelIssue.findFirst({
            where: {
              assetId: asset.id,
              litres: value,
              issueDate: issueDate,
              bulkTankId: mainPumpId
            }
          });

          if (existing) {
            totalSkipped++;
            continue;
          }

          const totalCost = Math.round(value * fuelPrice.pricePerLitre);

          await prisma.fuelIssue.create({
            data: {
              assetId: asset.id,
              fuelKind: "AUTO_DIESEL",
              litres: value,
              pricePerLitre: fuelPrice.pricePerLitre,
              totalCost: totalCost,
              source: mainPumpName,
              issueDate: issueDate,
              issuedById: chamilaUser.id,
              fuelPriceId: fuelPrice.id,
              bulkTankId: mainPumpId
            }
          });
          totalImported++;
        }
      }
    }
  }

  console.log(`Import completed. Imported: ${totalImported}, Skipped (duplicates): ${totalSkipped}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
