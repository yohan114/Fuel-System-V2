import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Backfill fuel for sites the daily-log importer never covered.
//
// The Consolidated Fuel Register carries two kinds of fuel data. Most sites have
// per-day rows in "Daily Fuel Log" (already imported by
// import_consolidated_register.cjs). Four sites only ever supplied monthly
// summaries, which live in "Vehicle Bill" — so they ended up with no fuel in the
// system at all. This imports those summaries as one issue per vehicle-month.
//
// Their months do NOT overlap the daily log (checked: Lot-02's daily rows are
// 2026-02/05/06 while its summaries stop at 2026-01), so nothing is double
// counted. Re-running is safe: each row carries a deterministic source label and
// existing rows are skipped.
//
// Historical backfill only — current tank balances are deliberately left alone,
// and no meter readings are written (a summary's running total is not a meter
// snapshot and would corrupt month-to-month deltas).
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const FILE = "data/source-sheets/Consolidated_Fuel_Register.xlsx";

// register label -> { project name, project code, created if missing }
const SITES: Record<string, { name: string; code: string }> = {
  "Batticaloa ICDP Lot 03": { name: "ICDP Batti Lot-03", code: "BATTI-03" },
  "Batticaloa ICDP Lot 02": { name: "ICDP Batti Lot-02", code: "BATTI-02" },
  "Gampaha Bridge":         { name: "Gampaha",           code: "GAMP" },
  // No existing project represents the A/B/C packages (E and F are separate
  // sites); scripts/import_cep_abc.ts intended this same code and name.
  "CEP-03 A/B/C":           { name: "CEP-03 A,B & C Package", code: "CEP-03-ABC" },
};

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Last day of the month, midday Colombo — safely inside the month in any tz.
function monthEnd(ym: string): Date | null {
  const m = ym.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const last = new Date(y, mo, 0).getDate();
  return new Date(`${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}T12:00:00+05:30`);
}

async function main() {
  console.log(`\n=== Summary-fuel backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const wb = XLSX.readFile(FILE);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets["Vehicle Bill"], { header: 1, defval: "" }) as any[][];
  let h = -1;
  for (let i = 0; i < 8; i++) if (String(raw[i]?.[0]).trim() === "Site / Project") { h = i; break; }
  if (h < 0) throw new Error("could not find header row in 'Vehicle Bill'");
  const rows = raw.slice(h + 1).filter((r) => String(r[0]).trim() !== "");

  // asset lookup
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user to attribute imported issues to");

  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true },
  });
  if (!prices.length) throw new Error("no AUTO_DIESEL fuel prices loaded");
  const priceAt = (d: Date) => {
    let pick = prices[0];
    for (const p of prices) { if (p.effectiveFrom <= d) pick = p; else break; }
    return pick;
  };

  let created = 0, skippedExisting = 0, noMatch = 0, noFuel = 0, badDate = 0, litresTotal = 0, costTotal = 0;
  const perSite: Record<string, { n: number; l: number; c: number; skip: number }> = {};
  const unmatched = new Set<string>();

  for (const [label, target] of Object.entries(SITES)) {
    const siteRows = rows.filter((r) => String(r[0]).trim() === label);
    if (!siteRows.length) { console.log(`\n${label}: no rows in register`); continue; }

    // project (create only the A/B/C one if genuinely absent)
    let project = await prisma.project.findUnique({ where: { code: target.code } });
    if (!project) {
      console.log(`  project ${target.code} (${target.name}) missing${APPLY ? " — creating" : " — would create"}`);
      if (APPLY) project = await prisma.project.create({ data: { code: target.code, name: target.name } });
    }
    let tank = project ? await prisma.bulkTank.findFirst({ where: { projectId: project.id } }) : null;
    if (project && !tank) {
      console.log(`  tank for ${target.code} missing${APPLY ? " — creating" : " — would create"}`);
      if (APPLY) tank = await prisma.bulkTank.create({
        data: { name: `${target.name} Tank`, fuelKind: "AUTO_DIESEL", capacity: 15000, balance: 0, projectId: project.id },
      });
    }

    const source = `Register summary (${label})`;
    const g = (perSite[label] ||= { n: 0, l: 0, c: 0, skip: 0 });

    for (const r of siteRows) {
      const ym = String(r[1]).trim();
      const vehNo = String(r[2]).trim();
      const litres = Number(r[5]) || 0;
      if (litres <= 0) { noFuel++; continue; }
      const when = monthEnd(ym);
      if (!when) { badDate++; continue; }

      const asset = byCode.get(alnum(vehNo)) || byReg.get(alnum(vehNo));
      if (!asset) { noMatch++; unmatched.add(vehNo); continue; }

      // deterministic identity: this asset, this site-summary, this month
      const exists = await prisma.fuelIssue.findFirst({
        where: { assetId: asset.id, source, issueDate: when },
        select: { id: true },
      });
      if (exists) { skippedExisting++; g.skip++; continue; }

      const p = priceAt(when);
      const cost = Math.round(litres * p.pricePerLitre);

      if (APPLY) {
        if (!tank) throw new Error(`no tank for ${label}`);
        await prisma.fuelIssue.create({ data: {
          fuelKind: "AUTO_DIESEL",
          litres,
          pricePerLitre: p.pricePerLitre,
          totalCost: cost,
          source,
          issueDate: when,
          assetId: asset.id,
          issuedById: admin.id,
          fuelPriceId: p.id,
          bulkTankId: tank.id,
          issuePerson: label,
        }});
      }
      created++; g.n++; g.l += litres; g.c += cost;
      litresTotal += litres; costTotal += cost;
    }

    console.log(`\n${label}`);
    console.log(`   rows ${siteRows.length} · importing ${g.n} · already present ${g.skip} · ${g.l.toFixed(0)} L · ${rs(g.c)}`);
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`  issues ${APPLY ? "created" : "to create"}: ${created}`);
  console.log(`  litres: ${litresTotal.toFixed(0)}   value: ${rs(costTotal)}`);
  console.log(`  skipped — already imported ${skippedExisting}, no fuel qty ${noFuel}, unmatched vehicle ${noMatch}, bad month ${badDate}`);
  if (unmatched.size) console.log(`  unmatched vehicles: ${[...unmatched].join(", ")}`);
  if (!APPLY) console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`);
  else console.log(`\nDone. Tank balances and meter readings were intentionally not modified.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
