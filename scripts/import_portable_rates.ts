import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import XLSX from "xlsx";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m) continue;
    let v = m[2] || "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v.trim();
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const CAT_CODE_MAP: Record<string, string> = {
  "Air Compressor": "PE-AC",
  "Angle Grinder": "PE-AG",
  "Circular Saw": "PE-CS",
  "Concrete Mixer": "PE-CM",
  "Engine Water Pump": "PE-EWP",
  "Generator": "PE-GEN",
  "Light Plant": "PE-LP",
  "Poker / Concrete Vibrator": "PE-PCV",
  "Power Tool — Other": "PE-PTO",
  "Rotary Hammer": "PE-RH",
  "Submersible Pump": "PE-SP",
  "Welding Plant": "PE-WLD"
};

function generateAssetCode(catCode: string, spec: string): string {
  const cleanSpec = spec
    .toUpperCase()
    .replace(/[–—\s()\/,.#"']+/g, "-") // replace dividers with hyphen
    .replace(/-+/g, "-") // reduce multiple hyphens
    .replace(/^-|-$/g, ""); // strip leading/trailing hyphens
  return `${catCode}-${cleanSpec}`.slice(0, 50);
}

async function main() {
  const excelPath = path.join(process.cwd(), "EnC_Fleet_Rate_Card_2026.xlsx");
  if (!fs.existsSync(excelPath)) {
    console.error(`Error: File not found at ${excelPath}`);
    process.exit(1);
  }

  console.log("Reading Portable Equipment sheet...");
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets["Portable Equipment"];
  if (!sheet) {
    console.error("Error: 'Portable Equipment' sheet not found");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  let count = 0;

  // Idempotency: Clear existing portable assets and their related records
  console.log("Querying existing portable assets...");
  const targetAssetIds = (
    await prisma.asset.findMany({
      where: { code: { startsWith: "PE-" } },
      select: { id: true }
    })
  ).map((a) => a.id);

  if (targetAssetIds.length > 0) {
    console.log(`Clearing related records for ${targetAssetIds.length} assets...`);
    await prisma.rentalRate.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.assetAssignment.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.fuelIssue.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.meterReading.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.dailyCondition.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.bill.deleteMany({ where: { assetId: { in: targetAssetIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: targetAssetIds } } });
  }

  // Data rows start at index 4 (row 5)
  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const catName = String(row[0] || "").trim();
    const spec = String(row[1] || "").trim();
    const wetRate = parseFloat(String(row[2] || "0"));
    const dryRate = parseFloat(String(row[3] || "0"));

    if (!catName || !spec) continue;

    const catCode = CAT_CODE_MAP[catName] || "PE-OTH";

    // 1. Ensure Category exists
    const category = await prisma.category.upsert({
      where: { code: catCode },
      update: { name: `PE - ${catName}` },
      create: {
        code: catCode,
        name: `PE - ${catName}`,
        defaultMeterType: "HOURS",
        fleetGroup: "MACHINERY_GENSET"
      }
    });

    // 2. Create Asset
    const assetCode = generateAssetCode(catCode, spec);
    const asset = await prisma.asset.create({
      data: {
        code: assetCode,
        typeLabel: catName,
        model: spec,
        meterType: "HOURS",
        status: "ACTIVE",
        categoryId: category.id
      }
    });

    // 3. Create RentalRate
    await prisma.rentalRate.create({
      data: {
        assetId: asset.id,
        sourceLabel: "EnC Portable Equipment Rate Card 2026",
        category: catName,
        equipType: "PORTABLE",
        portDwCents: Math.round(wetRate * 100),
        portDdCents: Math.round(dryRate * 100)
      }
    });

    count++;
    console.log(`  Imported ${assetCode}: Wet=${wetRate}, Dry=${dryRate}`);
  }

  console.log(`\n✓ Successfully imported ${count} portable equipment rate card items.`);
}

main()
  .catch((e) => {
    console.error("Error importing portable rates:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
