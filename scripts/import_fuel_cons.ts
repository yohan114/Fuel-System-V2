/**
 * Import fuel consumption rates from Fleet_Rental_Prices_2026_finalz.xlsx
 * into the RentalRate.fuelConsEcon / fuelConsTyp / fuelConsBasis columns.
 *
 * Source: "Fuel Rates" sheet, header at row 12 (1-based), data from row 13.
 * Columns used:
 *   B  = E&C No  (matches Asset.code)
 *   H  = Basis   ("Hour" | "KM")
 *   K  = Cons Econ
 *   L  = Cons Typ
 *
 * The mid-value (econ+typ)/2 is used in billing when no meter readings exist.
 *
 * Run: npx tsx scripts/import_fuel_cons.ts <path-to-xlsx>
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m) {
        let v = m[2] || "";
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env[m[1]] = v.trim();
      }
    }
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const xlsxPath = process.argv[2] || path.join(process.cwd(), "scripts", "data", "Fleet_Rental_Prices_2026_finalz.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets["Fuel Rates"];
  if (!ws) { console.error("Sheet 'Fuel Rates' not found"); process.exit(1); }

  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  // Header is row index 11 (0-based), data starts at 12
  const dataRows = raw.slice(12).filter((r: any[]) => r[1] && typeof r[1] === "string" && r[1].includes("-"));

  console.log(`Found ${dataRows.length} data rows in 'Fuel Rates' sheet.`);

  let updated = 0;
  let noRate = 0;
  let noAsset = 0;

  for (const row of dataRows) {
    const ec: string = String(row[1]).trim().toUpperCase();
    const reg: string = row[2] ? String(row[2]).trim().toUpperCase() : "";
    const basisRaw: string = typeof row[7] === "string" ? row[7].trim() : "";
    const fuelConsBasis = basisRaw === "KM" ? "km" : "hr";
    let consEcon: number | null = typeof row[10] === "number" ? row[10] : null;
    let consTyp: number | null = typeof row[11] === "number" ? row[11] : null;

    if (fuelConsBasis === "km") {
      if (consEcon && consEcon > 0) consEcon = 1 / consEcon;
      if (consTyp && consTyp > 0) consTyp = 1 / consTyp;
    }

    if (consEcon == null && consTyp == null) continue;

    // Find the asset by code, then by regNo
    let asset = await prisma.asset.findUnique({ where: { code: ec } });
    if (!asset && reg && reg !== "—") {
      asset = await prisma.asset.findFirst({ where: { regNo: reg } });
    }
    if (!asset) { noAsset++; continue; }

    // RentalRate must exist (created by import_rental_rates.ts)
    const existing = await prisma.rentalRate.findUnique({ where: { assetId: asset.id } });
    if (!existing) { noRate++; continue; }

    await prisma.rentalRate.update({
      where: { assetId: asset.id },
      data: { fuelConsEcon: consEcon, fuelConsTyp: consTyp, fuelConsBasis },
    });
    updated++;
  }

  const admin = await prisma.user.findFirst({ where: { username: "admin" } });
  await prisma.auditLog.create({
    data: {
      actorId: admin?.id ?? null,
      action: "UPDATE",
      entity: "RentalRate",
      summary: `Imported fuel consumption rates: ${updated} updated, ${noAsset} no matching asset, ${noRate} no rate card.`,
    },
  });

  console.log("\n========== Fuel Cons Import ==========");
  console.log(`Updated:        ${updated}`);
  console.log(`No asset match: ${noAsset}`);
  console.log(`No rate card:   ${noRate}`);
  console.log("======================================\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
