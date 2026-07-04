/**
 * Import the 2026 Fleet & Machinery Rental Price Sheet (per-unit update).
 *
 * "Fleet — Per Unit" carries one row per E&C number with the updated rental
 * tiers and fuel-consumption basis used for billing and fuel monitoring:
 *
 *   sheet DRY            → dry tier (d)  — bare machine, customer fuels
 *   sheet DRY+OPERATOR   → wet tier (w)  — machine+operator, fuel billed on top
 *   sheet WET            → fully-wet (fw)
 *   Cons. ECON/TYP/HEAVY → RentalRate.fuelConsEcon/Typ/Heavy — the consumption
 *       band, in the sheet's explicit "Cons. unit" (L/hr or L/km). Actual burn
 *       above HEAVY flags a repair candidate on /analytics/consumption.
 *
 * Monthly tiers are ignored (billing minimums cover monthly logic) and per-km
 * rental tiers are untouched (the sheet prices km vehicles hourly; only their
 * fuel basis is per km). Also upserts the CPC fuel prices from "Fuel & Inputs"
 * (Auto Diesel 382 eff 29-Jun-2026, Super Diesel 478 eff 30-May-2026).
 *
 * Reads ./Fleet_Machinery_Rental_Price_Sheet_2026.xlsx — override with RATE_SHEET=path.
 * DISPOSED tombstones are skipped. Idempotent.
 */
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const FILE = process.env.RATE_SHEET || path.join(process.cwd(), "Fleet_Machinery_Rental_Price_Sheet_2026.xlsx");

const FUEL_PRICES = [
  { fuelKind: "AUTO_DIESEL", pricePerLitre: 382_00, effectiveFrom: new Date("2026-06-29T00:00:00"), note: "CPC effective 29-Jun-2026 (cut of Rs.25) — 2026 rate sheet" },
  { fuelKind: "SUPER_DIESEL", pricePerLitre: 478_00, effectiveFrom: new Date("2026-05-30T00:00:00"), note: "Reference eff. 30-May-2026 — 2026 rate sheet" },
];

const toCents = (v: unknown): number | null => {
  const n = parseFloat(String(v));
  return isNaN(n) || n <= 0 ? null : Math.round(n * 100);
};

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Rate sheet not found at ${FILE}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(FILE, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Fleet — Per Unit"], { header: 1, defval: "" });
  const headerIdx = rows.findIndex((r) => String((r as unknown[])[0]) === "#");
  if (headerIdx < 0) throw new Error("Could not find the '#' header row in 'Fleet — Per Unit'");

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true, status: true } });
  const byCode = new Map(assets.map((a) => [a.code.toUpperCase(), a]));

  const stats = { matched: 0, skippedDisposed: 0, ratesUpdated: 0, ratesCreated: 0, consUpdated: 0, unmatched: [] as string[] };
  const samples: string[] = [];

  for (const raw of rows.slice(headerIdx + 1)) {
    const r = raw as unknown[];
    const code = String(r[5] ?? "").trim().toUpperCase();
    if (!code || code === "—" || isNaN(Number(r[0]))) continue; // section header / blank rows

    const asset = byCode.get(code);
    if (!asset) {
      stats.unmatched.push(code);
      continue;
    }
    if (asset.status === "DISPOSED") {
      stats.skippedDisposed++;
      continue;
    }
    stats.matched++;

    // Consumption band, in the sheet's explicit unit (L/hr or L/km).
    const consUnit = String(r[8] ?? "").trim().toLowerCase();
    const fuelConsBasis = consUnit === "l/km" ? "km" : consUnit === "l/hr" ? "hr" : null;
    const num = (v: unknown) => {
      const n = parseFloat(String(v));
      return isNaN(n) || n <= 0 ? null : n;
    };
    const fuelConsEcon = fuelConsBasis ? num(r[9]) : null;
    const fuelConsTyp = fuelConsBasis ? num(r[10]) : null;
    const fuelConsHeavy = fuelConsBasis ? num(r[11]) : null;

    const tierData = {
      hrDCents: toCents(r[17]),
      hrWCents: toCents(r[18]),
      hrFwCents: toCents(r[19]),
      dyDCents: toCents(r[20]),
      dyWCents: toCents(r[21]),
      dyFwCents: toCents(r[22]),
      ...(fuelConsBasis && fuelConsTyp != null ? { fuelConsEcon, fuelConsTyp, fuelConsHeavy, fuelConsBasis } : {}),
    };

    const existing = await prisma.rentalRate.findUnique({ where: { assetId: asset.id } });
    if (existing) {
      if (fuelConsTyp != null && existing.fuelConsTyp !== fuelConsTyp) stats.consUpdated++;
      await prisma.rentalRate.update({ where: { assetId: asset.id }, data: tierData });
      stats.ratesUpdated++;
      if (samples.length < 4 && (existing.fuelConsHeavy == null || existing.hrWCents !== tierData.hrWCents)) {
        samples.push(
          `${code}: band ${fuelConsEcon ?? "—"}/${fuelConsTyp ?? "—"}/${fuelConsHeavy ?? "—"} ${consUnit}, w ${tierData.hrWCents != null ? tierData.hrWCents / 100 : "—"} Rs/hr`
        );
      }
    } else {
      await prisma.rentalRate.create({
        data: { assetId: asset.id, equipType: "FLEET", sourceLabel: "2026 rate sheet", ...tierData },
      });
      stats.ratesCreated++;
    }
  }

  // Fuel price revisions.
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  let pricesUpserted = 0;
  for (const p of FUEL_PRICES) {
    await prisma.fuelPrice.upsert({
      where: { fuelKind_effectiveFrom: { fuelKind: p.fuelKind, effectiveFrom: p.effectiveFrom } },
      update: { pricePerLitre: p.pricePerLitre, note: p.note, source: "CEYPETCO" },
      create: { ...p, source: "CEYPETCO", enteredById: admin!.id },
    });
    pricesUpserted++;
  }

  console.log("── 2026 rate sheet import ───────────────────");
  console.log(`  Units matched:      ${stats.matched} (rates updated ${stats.ratesUpdated}, created ${stats.ratesCreated})`);
  console.log(`  Consumption changed: ${stats.consUpdated}`);
  console.log(`  DISPOSED skipped:   ${stats.skippedDisposed}`);
  if (stats.unmatched.length) console.log(`  ⚠ unmatched codes:  ${stats.unmatched.length} → ${stats.unmatched.slice(0, 8).join(", ")}`);
  for (const s of samples) console.log(`  e.g. ${s}`);
  console.log(`  Fuel prices upserted: ${pricesUpserted} (AD Rs 382 eff 29-Jun-2026, SD Rs 478 eff 30-May-2026)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
