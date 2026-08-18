import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

const CATEGORY_MAP: Record<
  string,
  { name: string; defaultMeterType: "KM" | "HOURS"; fleetGroup: "ROAD_VEHICLE" | "MACHINERY_GENSET" }
> = {
  // KM / ROAD_VEHICLE
  DT: { name: "Dump Truck", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  DC: { name: "Double Cab", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  SC: { name: "Single Cab", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  HCC: { name: "Crew Cab", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  TM: { name: "Truck Mixer", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BD: { name: "Bed Truck", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  DB: { name: "Dump Bowser", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  WB: { name: "Water Bowser", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BS: { name: "Bus", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  PV: { name: "Prime Mover", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  BM: { name: "Boom Truck", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },
  MB: { name: "Motor Bicycle", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" },

  // HOURS / MACHINERY_GENSET
  LB: { name: "Backhoe Loader", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  LD: { name: "Wheel Loader", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  SL: { name: "Skid Steer Loader", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  MG: { name: "Motor Grader", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  HEX: { name: "Excavator", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  SR: { name: "Static Roller", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  VR: { name: "Vibrating Roller", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  PTR: { name: "Pneumatic Roller", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  AP: { name: "Asphalt Paver", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  CR: { name: "Mobile Crane", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  PC: { name: "Pump Truck", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  FL: { name: "Fork Lift", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  FT: { name: "Farm Tractor", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
};

function parseYom(val: any): number | null {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = parseInt(val.trim(), 10);
    if (!isNaN(num)) return num;
  }
  return null;
}

function cleanString(val: any): string | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === "" ? null : str;
}

async function main() {
  console.log("Starting database seed...");

  // 1. Seed Categories
  console.log("Seeding asset categories...");
  const categoryDbIds: Record<string, string> = {};
  for (const [code, details] of Object.entries(CATEGORY_MAP)) {
    const cat = await prisma.category.upsert({
      where: { code },
      update: {
        name: details.name,
        defaultMeterType: details.defaultMeterType,
        fleetGroup: details.fleetGroup,
      },
      create: {
        code,
        name: details.name,
        defaultMeterType: details.defaultMeterType,
        fleetGroup: details.fleetGroup,
      },
    });
    categoryDbIds[code] = cat.id;
  }

  // Fallback category
  const fallbackCat = await prisma.category.upsert({
    where: { code: "OTHER" },
    update: {
      name: "Other Asset",
      defaultMeterType: "KM",
      fleetGroup: "ROAD_VEHICLE",
    },
    create: {
      code: "OTHER",
      name: "Other Asset",
      defaultMeterType: "KM",
      fleetGroup: "ROAD_VEHICLE",
    },
  });
  categoryDbIds["OTHER"] = fallbackCat.id;

  // 2. Seed Default Admin
  // No hardcoded fallback password — a fresh install must supply
  // SEED_ADMIN_PASSWORD, otherwise a random one is generated and printed once
  // so the credential never lives in source control.
  console.log("Seeding default admin user...");
  let adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = randomBytes(12).toString("base64url");
    console.log(`  Generated admin password (save it now): ${adminPassword}`);
  }
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      passwordHash,
      role: "ADMIN",
      name: "Administrator",
    },
    create: {
      username: "admin",
      name: "Administrator",
      passwordHash,
      role: "ADMIN",
      active: true,
    },
  });

  // 3. Seed Default Fuel Prices (Effective 2025 January to 2026 June)
  // Prices in cents (LKR * 100)
  console.log("Seeding historical fuel prices...");
  const historicalPrices = [
    { date: "2025-01-05", lad: 28600, lsd: 31300 },
    { date: "2025-02-01", lad: 28600, lsd: 33100 },
    { date: "2025-04-01", lad: 28600, lsd: 33100 },
    { date: "2025-04-30", lad: 27400, lsd: 32500 },
    { date: "2025-05-05", lad: 27400, lsd: 32500 },
    { date: "2025-07-01", lad: 28900, lsd: 32500 },
    { date: "2025-07-05", lad: 28900, lsd: 32500 },
    { date: "2025-09-01", lad: 28300, lsd: 31300 },
    { date: "2025-10-01", lad: 27700, lsd: 31300 },
    { date: "2025-11-01", lad: 27700, lsd: 31800 },
    { date: "2026-01-06", lad: 27900, lsd: 32300 },
    { date: "2026-02-01", lad: 27700, lsd: 32300 },
    { date: "2026-03-10", lad: 30300, lsd: 35300 },
    { date: "2026-03-22", lad: 38200, lsd: 44300 },
    { date: "2026-04-01", lad: 38200, lsd: 44300 },
    { date: "2026-05-03", lad: 39200, lsd: 45800 },
    { date: "2026-05-31", lad: 40700, lsd: 47800 }
  ];

  for (const fp of historicalPrices) {
    const effectiveDate = new Date(`${fp.date}T00:00:00Z`);

    await prisma.fuelPrice.upsert({
      where: {
        fuelKind_effectiveFrom: {
          fuelKind: "AUTO_DIESEL",
          effectiveFrom: effectiveDate,
        },
      },
      update: {
        pricePerLitre: fp.lad,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: "Historical Ceypetco price",
      },
      create: {
        fuelKind: "AUTO_DIESEL",
        pricePerLitre: fp.lad,
        effectiveFrom: effectiveDate,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: "Historical Ceypetco price",
      },
    });

    await prisma.fuelPrice.upsert({
      where: {
        fuelKind_effectiveFrom: {
          fuelKind: "SUPER_DIESEL",
          effectiveFrom: effectiveDate,
        },
      },
      update: {
        pricePerLitre: fp.lsd,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: "Historical Ceypetco price",
      },
      create: {
        fuelKind: "SUPER_DIESEL",
        pricePerLitre: fp.lsd,
        effectiveFrom: effectiveDate,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: "Historical Ceypetco price",
      },
    });
  }

  // 4. Seed Settings defaults
  console.log("Seeding settings...");
  const settingsDefaults = [
    { key: "scraper.enabled", value: "true" },
    { key: "scraper.cron", value: "0 0 1 * *" },
    { key: "backup.cron", value: "30 2 * * *" },
    { key: "backup.retentionDays", value: "7" },
    // Monthly billing defaults
    { key: "billing.enabled", value: "true" },
    { key: "billing.cron", value: "0 3 1 * *" },
    { key: "billing.minHours", value: "120" },
    { key: "billing.minKm", value: "3000" },
    { key: "billing.minDays", value: "26" },
    { key: "billing.ssclRate", value: "0.025" },
    { key: "billing.vatRate", value: "0.18" },
    { key: "billing.dueDays", value: "30" },
    { key: "billing.invoicePrefix", value: "EC-INV" },
    { key: "billing.fuelRateFallbackCents", value: "0" },
  ];
  for (const s of settingsDefaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }

  // 5. Parse and Seed Assets from Excel
  const excelPath = path.join(process.cwd(), "data", "fleet.xlsx");
  if (!fs.existsSync(excelPath)) {
    console.error(`Error: Fleet excel file not found at ${excelPath}`);
    process.exit(1);
  }

  console.log("Reading assets Excel file...");
  const workbook = XLSX.readFile(excelPath);

  // A. Parse "Plant list"
  console.log("Importing from 'Plant list' sheet...");
  const plantSheet = workbook.Sheets["Plant list"];
  const plantRows = XLSX.utils.sheet_to_json<any[]>(plantSheet, { header: 1 });
  let plantCount = 0;

  // Plant list data rows start at row index 3
  for (let i = 3; i < plantRows.length; i++) {
    const row = plantRows[i];
    const code = cleanString(row[1]); // E&C NO in column B (index 1)
    if (!code) continue;

    const brand = cleanString(row[2]);
    const typeLabel = cleanString(row[3]);
    const model = cleanString(row[4]);
    const regNo = cleanString(row[5]);
    const capacity = cleanString(row[6]);
    const yom = parseYom(row[7]);
    const serialNo = cleanString(row[8]);
    const chassisNo = cleanString(row[9]);
    const engineNo = cleanString(row[10]);

    // Extract prefix
    const prefix = code.split("-")[0].toUpperCase().trim();
    let categoryId = categoryDbIds[prefix];
    let meterType = "KM";

    if (categoryId) {
      meterType = CATEGORY_MAP[prefix].defaultMeterType;
    } else {
      console.warn(`Warning: Unknown category prefix "${prefix}" in code "${code}". Using OTHER.`);
      categoryId = categoryDbIds["OTHER"];
    }

    await prisma.asset.upsert({
      where: { code },
      update: {
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom,
        serialNo,
        chassisNo,
        engineNo,
        categoryId,
        meterType,
        status: "ACTIVE",
      },
      create: {
        code,
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom,
        serialNo,
        chassisNo,
        engineNo,
        categoryId,
        meterType,
        status: "ACTIVE",
      },
    });
    plantCount++;
  }
  console.log(`Seeded ${plantCount} assets from 'Plant list'.`);

  // B. Parse "Bike" sheet
  console.log("Importing from 'Bike' sheet...");
  const bikeSheet = workbook.Sheets["Bike"];
  const bikeRows = XLSX.utils.sheet_to_json<any[]>(bikeSheet, { header: 1 });
  let bikeCount = 0;

  // Bike data rows start at row index 2
  for (let i = 2; i < bikeRows.length; i++) {
    const row = bikeRows[i];
    if (!row || row.length === 0) continue;
    const regNo = cleanString(row[5]);
    const code = cleanString(row[1]) || (regNo ? `MB-${regNo}` : null);
    if (!code) continue;

    const brand = cleanString(row[2]);
    const typeLabel = cleanString(row[3]);
    const model = cleanString(row[4]);
    const capacity = cleanString(row[6]);
    const serialNo = cleanString(row[7]);
    const site = cleanString(row[8]);

    const prefix = "MB";
    const categoryId = categoryDbIds[prefix];
    const meterType = CATEGORY_MAP[prefix].defaultMeterType; // KM

    await prisma.asset.upsert({
      where: { code },
      update: {
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom: null,
        serialNo,
        site,
        categoryId,
        meterType,
        status: "ACTIVE",
      },
      create: {
        code,
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom: null,
        serialNo,
        site,
        categoryId,
        meterType,
        status: "ACTIVE",
      },
    });
    bikeCount++;
  }
  console.log(`Seeded ${bikeCount} assets from 'Bike'.`);

  console.log("Database seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error running database seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
