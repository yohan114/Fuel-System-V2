import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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
  "CEP-03 A,B and C - January 2026.xlsx",
  "CEP-03 A,B and C - February 2026.xlsx",
  "CEP-03 A,B and C - March 2026.xlsx"
];

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
  if (t.includes("pump")) return "CR"; // Pump car/concrete pump or similar CR
  return "HEX";
}

async function main() {
  const assets = await prisma.asset.findMany({
    include: { rentalRate: true }
  });
  const dbVehicles = new Map();
  assets.forEach(a => {
    dbVehicles.set(a.code.toUpperCase().replace(/[\s\-_]/g, ""), a);
    if (a.regNo) {
      dbVehicles.set(a.regNo.toUpperCase().replace(/[\s\-_]/g, ""), a);
    }
  });

  const sheetVehicles = new Map();

  for (const filename of FILES) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    
    // Find header
    let headerIdx = 2;
    const headerRow = rows[headerIdx];
    const vehCol = headerRow.findIndex(c => String(c).toLowerCase().includes("vehicle no"));
    const typeCol = headerRow.findIndex(c => String(c).toLowerCase() === "type");

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      // Check if external vehicles section begins
      if (row.some(c => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) {
        console.log(`[${filename}] Stopping at row ${r} due to External Vehicle section.`);
        break;
      }

      const vehicleNo = String(row[vehCol] || "").trim();
      const type = String(row[typeCol] || "").trim();
      if (!vehicleNo || vehicleNo.toLowerCase() === "vehicle no" || vehicleNo.toLowerCase().includes("running")) continue;
      
      const key = vehicleNo.toUpperCase().replace(/[\s\-_]/g, "");
      if (!key) continue;

      if (!sheetVehicles.has(key)) {
        sheetVehicles.set(key, { vehicleNo, type, files: [] });
      }
      sheetVehicles.get(key).files.push(filename);
    }
  }

  console.log(`\nUnique vehicles found in spreadsheets: ${sheetVehicles.size}`);
  
  let missingCount = 0;
  for (const [key, info] of sheetVehicles.entries()) {
    const dbAsset = dbVehicles.get(key);
    if (dbAsset) {
      console.log(`MATCHED: ${info.vehicleNo} -> DB code: ${dbAsset.code} (${dbAsset.typeLabel || dbAsset.brand}), hasRateCard: ${!!dbAsset.rentalRate}`);
    } else {
      missingCount++;
      const catCode = mapTypeToCategory(info.type);
      console.log(`MISSING: ${info.vehicleNo} (Type: "${info.type}" -> Cat: ${catCode}) in files:`, info.files);
    }
  }
  console.log(`\nTotal Missing Vehicles: ${missingCount}`);
  await prisma.$disconnect();
}

main().catch(console.error);
