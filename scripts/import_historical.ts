import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

// 1. Load environment variables from .env
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

// Project sites and other non-vehicle lines to skip
const sitesToSkip = new Set([
  "head office",
  "mallawagedara",
  "marawila site",
  "ecto",
  "wadakada",
  "mundalam estate",
  "mrs.charithas estate",
  "badalgama w/s",
  "fire drill",
  "filter filling",
  "work shop vehicle start",
  "error correction"
]);

function isProjectSiteOrSummary(regNo: string): boolean {
  const clean = regNo.toLowerCase().trim();
  if (clean === "" || clean.startsWith("total issue")) {
    return true;
  }
  return sitesToSkip.has(clean);
}

// Ceypetco fuel prices structure
const FUEL_PRICES_SEED = [
  { date: "2026-03-01T00:00:00.000Z", lad: 28100, lsd: 32900, note: "Ceypetco March 1 revision" },
  { date: "2026-03-10T00:00:00.000Z", lad: 30300, lsd: 35300, note: "Ceypetco March 10 revision" },
  { date: "2026-03-22T00:00:00.000Z", lad: 38200, lsd: 44300, note: "Ceypetco March 22 revision" },
  { date: "2026-04-01T00:00:00.000Z", lad: 38200, lsd: 44300, note: "Ceypetco April 1 revision" },
  { date: "2026-05-03T00:00:00.000Z", lad: 39200, lsd: 45800, note: "Ceypetco May 3 revision" },
  { date: "2026-05-31T00:00:00.000Z", lad: 40700, lsd: 47800, note: "Ceypetco May 31 revision" }
];

async function main() {
  console.log("Starting historical fuel dispatches import...");

  // 1. Resolve production admin user
  const adminUser = await prisma.user.findFirst({
    where: { username: "admin" }
  });
  if (!adminUser) {
    console.error("Error: Admin user not found in database. Please seed the database first.");
    process.exit(1);
  }
  console.log(`Resolved admin user: "${adminUser.name}" (${adminUser.id})`);

  // 2. Resolve or create Badalgama Main pump bulk tank
  let mainPump = await prisma.bulkTank.findFirst({
    where: {
      name: {
        contains: "Badalgama",
      },
    },
  });

  if (!mainPump) {
    console.log("Badalgama Bulk Tank not found. Creating 'Badalgama Main Workshop Main pump'...");
    mainPump = await prisma.bulkTank.create({
      data: {
        name: "Badalgama Main Workshop Main pump",
        fuelKind: "AUTO_DIESEL",
        capacity: 25000.0,
        balance: 24500.0,
      }
    });
  }
  console.log(`Resolved bulk tank: "${mainPump.name}" (${mainPump.id})`);

  // 2.5. Resolve or create Chamila Welarathne user
  let chamilaUser = await prisma.user.findUnique({
    where: { username: "chamila" }
  });
  if (!chamilaUser) {
    console.log("Creating user 'Chamila Welarathne'...");
    const passwordHash = bcrypt.hashSync("chamila123", 10);
    chamilaUser = await prisma.user.create({
      data: {
        username: "chamila",
        name: "Chamila Welarathne",
        passwordHash,
        role: "WORKSHOP",
        active: true,
        bulkTankId: mainPump.id,
      }
    });
  }
  console.log(`Resolved operator user: "${chamilaUser.name}" (${chamilaUser.id})`);

  // 3. Resolve or create fallback category 'OTHER'
  let otherCategory = await prisma.category.findUnique({
    where: { code: "OTHER" },
  });
  if (!otherCategory) {
    console.log("Creating default category 'OTHER'...");
    otherCategory = await prisma.category.create({
      data: {
        code: "OTHER",
        name: "Other Asset",
        defaultMeterType: "KM",
        fleetGroup: "ROAD_VEHICLE",
      },
    });
  }

  // 4. Seed Ceypetco Historical prices in the database
  console.log("Seeding Ceypetco historical fuel prices...");
  for (const fp of FUEL_PRICES_SEED) {
    const effectiveFrom = new Date(fp.date);
    
    // LAD (Auto Diesel) price
    await prisma.fuelPrice.upsert({
      where: {
        fuelKind_effectiveFrom: {
          fuelKind: "AUTO_DIESEL",
          effectiveFrom,
        },
      },
      update: {
        pricePerLitre: fp.lad,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: fp.note,
      },
      create: {
        fuelKind: "AUTO_DIESEL",
        pricePerLitre: fp.lad,
        effectiveFrom,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: fp.note,
      },
    });

    // LSD (Super Diesel) price
    await prisma.fuelPrice.upsert({
      where: {
        fuelKind_effectiveFrom: {
          fuelKind: "SUPER_DIESEL",
          effectiveFrom,
        },
      },
      update: {
        pricePerLitre: fp.lsd,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: fp.note,
      },
      create: {
        fuelKind: "SUPER_DIESEL",
        pricePerLitre: fp.lsd,
        effectiveFrom,
        source: "CEYPETCO",
        enteredById: adminUser.id,
        note: fp.note,
      },
    });
  }
  console.log("All Ceypetco fuel prices registered.");

  let totalImported = 0;
  let totalSkipped = 0;
  let totalSitesSkipped = 0;
  let newAssetsCount = 0;

  for (const f of files) {
    if (!fs.existsSync(f.path)) {
      console.error(`Error: File not found: ${f.path}`);
      process.exit(1);
    }
    console.log(`\nProcessing file: ${path.basename(f.path)}`);

    const workbook = XLSX.readFile(f.path);
    const sheet = workbook.Sheets[f.sheet];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

    // Rows 6 to 153 contain data (index 6 is row 7, index 153 is row 154)
    for (let i = 6; i <= 153; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;

      const sNo = row[0];
      const rawRegNo = row[1];
      if (sNo === undefined || rawRegNo === undefined || rawRegNo === null) continue;

      const regNo = String(rawRegNo).trim();
      if (isProjectSiteOrSummary(regNo)) {
        totalSitesSkipped++;
        continue;
      }

      const formattedRegNo = regNo.toUpperCase();

      // Resolve Asset: match by code or registration number (case-insensitive)
      let asset = await prisma.asset.findFirst({
        where: {
          OR: [
            { code: formattedRegNo },
            { regNo: formattedRegNo }
          ]
        }
      });

      if (!asset) {
        console.log(`Asset not found. Creating vehicle asset: "${formattedRegNo}" under 'OTHER'...`);
        asset = await prisma.asset.create({
          data: {
            code: formattedRegNo,
            regNo: formattedRegNo,
            categoryId: otherCategory.id,
            meterType: "KM",
            status: "ACTIVE",
            brand: "Quick Added",
            typeLabel: "Other Asset",
          }
        });
        newAssetsCount++;
      }

      // Loop days 1 to 31
      for (let day = 1; day <= 31; day++) {
        const value = row[4 + day]; // day 1 is index 5
        if (typeof value === "number" && value > 0) {
          // Construct precise issue date (8:00 AM UTC for clean timestamps)
          const dayStr = String(day).padStart(2, "0");
          const monthStr = String(f.month).padStart(2, "0");
          const issueDate = new Date(`2026-${monthStr}-${dayStr}T08:00:00.000Z`);

          // Resolve the correct Ceypetco price active on that specific date
          const fuelPrice = await prisma.fuelPrice.findFirst({
            where: {
              fuelKind: "AUTO_DIESEL",
              effectiveFrom: {
                lte: issueDate,
              },
            },
            orderBy: {
              effectiveFrom: "desc",
            },
          });

          if (!fuelPrice) {
            throw new Error(`Could not resolve Auto Diesel price for date: ${issueDate.toISOString()}`);
          }

          // Idempotency check: see if this issue is already in the database
          const existingIssue = await prisma.fuelIssue.findFirst({
            where: {
              assetId: asset.id,
              litres: value,
              issueDate: issueDate,
              bulkTankId: mainPump.id,
            }
          });

          if (existingIssue) {
            totalSkipped++;
            continue;
          }

          // Insert new FuelIssue
          const totalCost = Math.round(value * fuelPrice.pricePerLitre);
          await prisma.fuelIssue.create({
            data: {
              assetId: asset.id,
              fuelKind: "AUTO_DIESEL",
              litres: value,
              pricePerLitre: fuelPrice.pricePerLitre,
              totalCost: totalCost,
              source: mainPump.name,
              issueDate: issueDate,
              issuedById: chamilaUser.id,
              fuelPriceId: fuelPrice.id,
              bulkTankId: mainPump.id,
            }
          });
          totalImported++;
        }
      }
    }
  }

  console.log(`\nImport Process Completed!`);
  console.log(`- Created ${newAssetsCount} new Assets`);
  console.log(`- Created ${totalImported} new FuelIssue records`);
  console.log(`- Skipped ${totalSkipped} duplicate FuelIssue records`);
  console.log(`- Skipped ${totalSitesSkipped} project site or summary rows`);
}

main()
  .catch((e) => {
    console.error("Migration script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
