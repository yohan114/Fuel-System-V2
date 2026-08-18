import { prisma } from "../src/lib/db";
import { getMonthSegments } from "../src/lib/assignments";
import { getBillingConfig, minimumForMode } from "../src/lib/billing/config";
import fs from "fs";
import path from "path";

// Who was on a site in a month, and what minimum does each one owe?
//
// Billing starts from the posting, not the pump: a vehicle owes rental for the
// days it was ALLOCATED to a site, and the monthly guarantee (120 h / 3,000 km)
// is prorated to those days. A machine that arrives on the 11th owes 21/31 of
// the guarantee, not all of it and not nothing.
//
// So the two questions that decide a site's month are "who was posted here, for
// how long" and "is anyone drawing fuel here who was never posted at all" — the
// second being the one that silently bills the wrong site, or no site. Both are
// answered side by side below.
//
// Read-only. Nothing here writes a bill.
//
//   npx tsx scripts/site_month_vehicles.ts --site=CEP-03F --month=2026-05
//   npx tsx scripts/site_month_vehicles.ts --site=CEP-03F --month=2026-05 --csv=may.csv

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const MONTH = arg("month");
const CSV = arg("csv");

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const rs = (c: number) => "Rs " + Math.round(c / 100).toLocaleString("en-LK");
const n1 = (x: number) => x.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Mirrors defaultModeForAsset in the billing engine: what the meter measures
// decides what the machine is billed on.
function modeFor(meterType: string | null, equipType: string): "hourly" | "perkm" | "perday" {
  if (equipType === "PORTABLE") return "perday";
  if (meterType === "KM") return "perkm";
  if (meterType === "HOURS") return "hourly";
  return "perday";
}

function pickRate(r: { hrFwCents: number | null; hrWCents: number | null; hrDCents: number | null;
  kmFwCents: number | null; kmWCents: number | null; kmDCents: number | null;
  dyFwCents: number | null; dyWCents: number | null; dyDCents: number | null;
  portDwCents: number | null; portDdCents: number | null } | null,
  mode: string, basis: string): number | null {
  if (!r) return null;
  if (mode === "hourly") return basis === "fw" ? r.hrFwCents : basis === "d" ? r.hrDCents : r.hrWCents;
  if (mode === "perkm") return basis === "fw" ? r.kmFwCents : basis === "d" ? r.kmDCents : r.kmWCents;
  if (r.portDwCents != null || r.portDdCents != null) return basis === "d" ? r.portDdCents : r.portDwCents;
  return basis === "fw" ? r.dyFwCents : basis === "d" ? r.dyDCents : r.dyWCents;
}

async function main() {
  if (!SITE || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) throw new Error("need --site=CODE --month=YYYY-MM");
  const [y, m] = MONTH.split("-").map(Number);
  const periodStart = new Date(`${MONTH}-01T00:00:00+05:30`);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const periodEnd = new Date(`${MONTH}-${String(daysInMonth).padStart(2, "0")}T23:59:59+05:30`);

  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`\n=== ${SITE} · ${MONTH} · who was here and what they owe ===`);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);

  const project = await prisma.project.findUnique({ where: { code: SITE }, select: { id: true, code: true, name: true } });
  if (!project) throw new Error(`site ${SITE} not found`);
  const cfg = await getBillingConfig();
  console.log(`  ${project.name} · ${daysInMonth} days in month`);
  console.log(`  monthly guarantee: ${cfg.minHours} h (metered by hours) · ${cfg.minKm} km (metered by km) · ${cfg.minDays} days (portable)\n`);

  // Everyone with a posting that touches the month, plus everyone who drew fuel
  // from this site's pump. The second set is the one worth looking at twice.
  const posted = await prisma.assetAssignment.findMany({
    where: { projectId: project.id, startDate: { lte: periodEnd },
      OR: [{ endDate: null }, { endDate: { gte: periodStart } }] },
    select: { assetId: true } });
  const tanks = await prisma.bulkTank.findMany({ where: { projectId: project.id }, select: { id: true } });
  const fuel = await prisma.fuelIssue.findMany({
    where: { bulkTankId: { in: tanks.map((t) => t.id) }, voided: false,
      issueDate: { gte: periodStart, lte: periodEnd } },
    select: { assetId: true, litres: true, totalCost: true, issueDate: true } });

  const fuelBy = new Map<string, { litres: number; cost: number; draws: number; lo: string; hi: string }>();
  for (const f of fuel) {
    const d = dayOf(f.issueDate);
    const e = fuelBy.get(f.assetId) ?? { litres: 0, cost: 0, draws: 0, lo: "9999-99-99", hi: "0" };
    fuelBy.set(f.assetId, { litres: e.litres + f.litres, cost: e.cost + f.totalCost, draws: e.draws + 1,
      lo: d < e.lo ? d : e.lo, hi: d > e.hi ? d : e.hi });
  }

  const ids = [...new Set([...posted.map((p) => p.assetId), ...fuelBy.keys()])];
  if (!ids.length) { console.log(`  nobody was posted here and no fuel was drawn.\n`); return; }

  const assets = await prisma.asset.findMany({ where: { id: { in: ids } },
    include: { rentalRate: true }, orderBy: { code: "asc" } });

  type Line = {
    code: string; reg: string; type: string; mode: string; days: number;
    from: string; to: string; minFull: number; minPro: number; min30: number;
    rateCents: number | null; basis: string; litres: number; unit: string; hasPosting: boolean;
  };
  const lines: Line[] = [];

  for (const a of assets) {
    // The segment resolver assigns every day to exactly ONE site, so a vehicle
    // double-posted cannot be billed twice for the same day.
    const segs = await getMonthSegments(a.id, periodStart, periodEnd);
    const here = segs.filter((s) => s.projectId === project.id);
    const days = here.reduce((n, s) => n + s.days, 0);
    const mode = modeFor(a.meterType, a.rentalRate?.equipType ?? "");
    const assetMin = mode === "hourly" && a.minBillHours ? a.minBillHours : null;
    const minFull = assetMin ?? minimumForMode(cfg, mode);
    const basis = here[0]?.billingType === "DRY" ? "d" : (a.rentalRate?.defaultBasis ?? "w");
    const f = fuelBy.get(a.id);
    lines.push({
      code: a.code, reg: a.regNo ?? "—", type: a.typeLabel ?? "—", mode,
      days, from: here.length ? dayOf(here[0].start) : "—", to: here.length ? dayOf(here[here.length - 1].end) : "—",
      minFull,
      minPro: minFull * (days / daysInMonth),
      min30: minFull * (days / 30),
      rateCents: pickRate(a.rentalRate, mode, basis), basis,
      litres: f?.litres ?? 0,
      unit: mode === "perkm" ? "km" : mode === "hourly" ? "h" : "d",
      hasPosting: days > 0,
    });
  }
  lines.sort((x, z) => (z.days - x.days) || x.code.localeCompare(z.code));

  const on = lines.filter((l) => l.hasPosting);
  const off = lines.filter((l) => !l.hasPosting);

  console.log(`--- posted to ${project.code} in ${MONTH} (${on.length}) ---`);
  console.log(`  ${"vehicle".padEnd(11)}${"reg".padEnd(11)}${"billed on".padEnd(10)}${"from".padEnd(12)}${"to".padEnd(12)}` +
    `${"days".padStart(5)}${"full min".padStart(10)}${"pro-rata".padStart(10)}${"rate".padStart(12)}${"min rental".padStart(13)}`);
  for (const l of on) {
    const minRental = l.rateCents != null ? rs(Math.round(l.minPro * l.rateCents)) : "no rate card";
    console.log(`  ${l.code.padEnd(11)}${l.reg.padEnd(11)}${(l.mode + "/" + l.basis).padEnd(10)}${l.from.padEnd(12)}${l.to.padEnd(12)}` +
      `${String(l.days).padStart(5)}${(l.minFull + l.unit).padStart(10)}${(n1(l.minPro) + l.unit).padStart(10)}` +
      `${(l.rateCents != null ? rs(l.rateCents) : "—").padStart(12)}${minRental.padStart(13)}`);
  }
  if (!on.length) console.log(`  none — no vehicle is allocated to this site for ${MONTH}`);

  if (off.length) {
    console.log(`\n--- drew fuel here but was NEVER POSTED here (${off.length}) ---`);
    console.log(`  These bill to whichever site they were posted to, or to nobody.`);
    for (const l of off) {
      const f = fuelBy.get(assets.find((a) => a.code === l.code)!.id)!;
      console.log(`  ${l.code.padEnd(11)}${l.reg.padEnd(11)}${String(f.draws).padStart(4)} draws  ${String(f.litres).padStart(6)} L   ${f.lo} .. ${f.hi}`);
    }
    console.log(`  Fix with: npx tsx scripts/post_pump_vehicles.ts --site=${SITE} --from=${MONTH}-01 --to=${MONTH}-${daysInMonth}`);
  }

  const totPro = on.reduce((n, l) => n + (l.rateCents ?? 0) * l.minPro, 0);
  const tot30 = on.reduce((n, l) => n + (l.rateCents ?? 0) * l.min30, 0);
  console.log(`\n--- the guarantee, two ways ---`);
  console.log(`  by calendar (${daysInMonth}-day month, what the system bills): ${rs(Math.round(totPro))}`);
  console.log(`  by a flat 30-day month:                                       ${rs(Math.round(tot30))}`);
  const diff = Math.round(tot30 - totPro);
  if (diff !== 0) {
    console.log(`  difference: ${rs(Math.abs(diff))} ${diff > 0 ? "MORE" : "LESS"} on the flat-30 rule`);
    console.log(`  A ${daysInMonth}-day month divided by 30 charges ${n1((daysInMonth / 30) * 100)}% of the guarantee`);
    console.log(`  to a vehicle present all month, which is why the calendar is used.`);
  }

  if (CSV) {
    const head = "vehicle,reg,type,billed_on,basis,from,to,days,full_minimum,prorated_minimum,unit,rate_rs,minimum_rental_rs,fuel_litres_here\n";
    const body = on.map((l) => [l.code, l.reg, `"${l.type}"`, l.mode, l.basis, l.from, l.to, l.days,
      l.minFull, l.minPro.toFixed(2), l.unit, l.rateCents != null ? Math.round(l.rateCents / 100) : "",
      l.rateCents != null ? Math.round(l.minPro * l.rateCents / 100) : "", l.litres].join(",")).join("\n");
    fs.writeFileSync(CSV, head + body + "\n");
    console.log(`\n  wrote ${CSV}`);
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
