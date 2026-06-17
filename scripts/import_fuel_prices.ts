/**
 * Seed historical Ceypetco fuel prices (AUTO_DIESEL + SUPER_DIESEL) from
 * January 2025 onward into the FuelPrice table.
 *
 * Each entry creates one price record effective from the given date. The
 * billing engine picks the latest price with effectiveFrom <= the fuel-issue
 * date, so you only need one row per price *change* (not per month).
 *
 * ⚠️  VERIFY THESE NUMBERS against https://ceypetco.gov.lk/historical-prices/
 *     before running — the site blocks automated scraping, so the values below
 *     must be confirmed by a human. Prices are WHOLE RUPEES here and converted
 *     to cents (× 100) on insert. Edit the PRICES table, then run:
 *
 *       npx tsx scripts/import_fuel_prices.ts
 *
 * Idempotent: upserts on the (fuelKind, effectiveFrom) unique key.
 */
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

// ── EDIT ME ──────────────────────────────────────────────────────────────────
// One row per price CHANGE. date = "YYYY-MM-DD" (Colombo). Prices in whole LKR.
// Fill from the official Ceypetco historical-prices page.
const PRICES: { date: string; autoDiesel: number; superDiesel: number }[] = [
  { date: "2025-01-05", autoDiesel: 286, superDiesel: 313 },
  { date: "2025-02-01", autoDiesel: 286, superDiesel: 331 },
  { date: "2025-04-01", autoDiesel: 286, superDiesel: 331 },
  { date: "2025-04-30", autoDiesel: 274, superDiesel: 325 },
  { date: "2025-05-05", autoDiesel: 274, superDiesel: 325 },
  { date: "2025-07-01", autoDiesel: 289, superDiesel: 325 },
  { date: "2025-07-05", autoDiesel: 289, superDiesel: 325 },
  { date: "2025-09-01", autoDiesel: 283, superDiesel: 313 },
  { date: "2025-10-01", autoDiesel: 277, superDiesel: 313 },
  { date: "2025-11-01", autoDiesel: 277, superDiesel: 318 },
  { date: "2026-01-06", autoDiesel: 279, superDiesel: 323 },
  { date: "2026-02-01", autoDiesel: 277, superDiesel: 323 },
  { date: "2026-03-10", autoDiesel: 303, superDiesel: 353 },
  { date: "2026-03-22", autoDiesel: 382, superDiesel: 443 },
  { date: "2026-04-01", autoDiesel: 382, superDiesel: 443 },
  { date: "2026-05-03", autoDiesel: 392, superDiesel: 458 },
  { date: "2026-05-31", autoDiesel: 407, superDiesel: 478 }
];
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (PRICES.length === 0) {
    console.error("PRICES table is empty — fill in the verified Ceypetco figures first.");
    process.exit(1);
  }
  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found — run seed first");

  let count = 0;
  for (const p of PRICES) {
    const effectiveFrom = new Date(`${p.date}T00:00:00+05:30`);
    for (const [fuelKind, rupees] of [["AUTO_DIESEL", p.autoDiesel], ["SUPER_DIESEL", p.superDiesel]] as const) {
      if (!rupees || rupees <= 0) continue;
      await prisma.fuelPrice.upsert({
        where: { fuelKind_effectiveFrom: { fuelKind, effectiveFrom } },
        update: { pricePerLitre: Math.round(rupees * 100), source: "CEYPETCO" },
        create: {
          fuelKind,
          pricePerLitre: Math.round(rupees * 100),
          effectiveFrom,
          source: "CEYPETCO",
          note: "Historical price from ceypetco.gov.lk/historical-prices",
          enteredById: sysUser.id,
        },
      });
      count++;
    }
  }

  await prisma.auditLog.create({
    data: { action: "IMPORT", entity: "FuelPrice", entityId: "bulk", summary: `Imported ${count} historical fuel price records (${PRICES.length} revisions) from Ceypetco.` },
  });
  console.log(`Upserted ${count} fuel-price records across ${PRICES.length} revision dates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
