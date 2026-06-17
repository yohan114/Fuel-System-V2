/**
 * Recreate the full machine list (Categories + Assets + RentalRate cards) from
 * scripts/data/rate_cards.json, which is extracted from the E&C "Machine Rental
 * & Timesheet Calculator" HTML (FLEET_MACHINES + PORTABLE_EQUIPMENT).
 *
 * What it stores:
 *   - Category   per distinct "cat" (code derived from the dominant E&C prefix,
 *                defaultMeterType + fleetGroup inferred from member machines).
 *   - Asset      one per fleet machine (518). code = E&C No; machines without an
 *                E&C code fall back to their reg no, then a synthetic M-<id>.
 *   - RentalRate ALL tiers stored (fw / w / d for hourly/perday/perkm). Billing
 *                uses the WET (driver-only) tier by default; fw/d are kept for
 *                when they are needed.
 *
 * Fuel consumption (Cons Econ / Cons Typ) lives in the Excel "Fuel Rates" sheet
 * and is loaded separately by scripts/import_fuel_cons.ts.
 *
 * Source rates are whole LKR → converted to cents (× 100).
 *
 * Run: npx tsx scripts/import_machines.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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

type Tier = { fw?: number | null; w?: number | null; d?: number | null } | null;
interface FleetMachine {
  id: number; label: string; cat: string;
  reg?: string; ec?: string; model?: string; year?: string;
  km?: number; fuel?: number; op?: number;
  r: { h: Tier; dy: Tier; km: Tier };
}

const toCents = (v: number | null | undefined): number | null =>
  v == null || isNaN(v as number) ? null : Math.round((v as number) * 100);
const tierCents = (t: Tier) => ({ fw: toCents(t?.fw ?? null), w: toCents(t?.w ?? null), d: toCents(t?.d ?? null) });

// A machine is metered by KM if it carries a per-km rate tier, else by HOURS.
function meterTypeOf(m: FleetMachine): "KM" | "HOURS" {
  const km = m.r?.km;
  const hasKm = km && (km.fw || km.w || km.d);
  return hasKm ? "KM" : "HOURS";
}

function acronym(name: string): string {
  return name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 4) || "GEN";
}

function parseYom(year?: string): number | null {
  const n = parseInt((year || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null;
}

function parseLabel(m: FleetMachine): { brand: string | null; model: string | null } {
  // label = "EC · REG · CAT · BRAND MODEL (YEAR)"
  const brand = m.model ? m.model.split(/\s+/)[0] : null;
  return { brand, model: m.model || null };
}

async function main() {
  const dataPath = path.join(process.cwd(), "scripts", "data", "rate_cards.json");
  const { fleet } = JSON.parse(fs.readFileSync(dataPath, "utf8")) as { fleet: FleetMachine[] };
  console.log(`Loaded ${fleet.length} fleet machines.`);

  // ── 1. Build categories ────────────────────────────────────────────────────
  // For each distinct cat: code = dominant non-empty E&C prefix, else acronym.
  const catInfo = new Map<string, { prefixes: Map<string, number>; km: number; hr: number }>();
  for (const m of fleet) {
    const info = catInfo.get(m.cat) || { prefixes: new Map(), km: 0, hr: 0 };
    const prefix = (m.ec || "").split("-")[0].trim().toUpperCase();
    if (prefix) info.prefixes.set(prefix, (info.prefixes.get(prefix) || 0) + 1);
    if (meterTypeOf(m) === "KM") info.km++; else info.hr++;
    catInfo.set(m.cat, info);
  }

  const usedCodes = new Set<string>();
  const catCode = new Map<string, string>();
  for (const [cat, info] of catInfo) {
    let code = [...info.prefixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || acronym(cat);
    let base = code, n = 2;
    while (usedCodes.has(code)) code = `${base}${n++}`;
    usedCodes.add(code);
    catCode.set(cat, code);

    const defaultMeterType = info.km >= info.hr ? "KM" : "HOURS";
    const fleetGroup = defaultMeterType === "KM" ? "ROAD_VEHICLE" : "MACHINERY_GENSET";
    await prisma.category.upsert({
      where: { code },
      update: { name: cat, defaultMeterType, fleetGroup },
      create: { code, name: cat, defaultMeterType, fleetGroup },
    });
  }
  console.log(`Created/updated ${catCode.size} categories.`);

  // ── 2. Create assets + rate cards ───────────────────────────────────────────
  const usedAssetCodes = new Set<string>();
  let created = 0;
  for (const m of fleet) {
    const cat = await prisma.category.findUnique({ where: { code: catCode.get(m.cat)! } });
    if (!cat) continue;

    let code = (m.ec || "").trim().toUpperCase();
    if (!code) code = (m.reg || "").trim().toUpperCase();
    if (!code) code = `M-${m.id}`;
    let base = code, n = 2;
    while (usedAssetCodes.has(code)) code = `${base}#${n++}`;
    usedAssetCodes.add(code);

    const { brand, model } = parseLabel(m);
    const meterType = meterTypeOf(m);

    const asset = await prisma.asset.create({
      data: {
        code,
        regNo: m.reg && m.reg !== "—" ? m.reg.trim().toUpperCase() : null,
        brand,
        model,
        typeLabel: m.cat,
        yom: parseYom(m.year),
        meterType,
        status: "ACTIVE",
        categoryId: cat.id,
      },
    });

    const h = tierCents(m.r?.h ?? null);
    const dy = tierCents(m.r?.dy ?? null);
    const km = tierCents(m.r?.km ?? null);
    await prisma.rentalRate.create({
      data: {
        assetId: asset.id,
        sourceLabel: m.label,
        category: m.cat,
        equipType: "FLEET",
        fuelQtyDefault: m.fuel ?? null,
        opRate: toCents(m.op ?? null),
        hrFwCents: h.fw, hrWCents: h.w, hrDCents: h.d,
        dyFwCents: dy.fw, dyWCents: dy.w, dyDCents: dy.d,
        kmFwCents: km.fw, kmWCents: km.w, kmDCents: km.d,
      },
    });
    created++;
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  await prisma.auditLog.create({
    data: {
      actorId: admin?.id ?? null,
      action: "CREATE",
      entity: "Asset",
      summary: `Imported machine list: ${catCode.size} categories, ${created} assets + rate cards (all tiers; billing default = WET).`,
    },
  });

  console.log("\n========== Machine Import Summary ==========");
  console.log(`Categories:           ${catCode.size}`);
  console.log(`Assets + rate cards:  ${created}`);
  console.log("Rate tiers stored:    fw / w / d (hourly, per-day, per-km)");
  console.log("Billing default basis: WET (w) — driver only");
  console.log("===========================================\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
