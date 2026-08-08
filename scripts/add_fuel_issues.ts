import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Add a day's fuel to a site's pump from plain lines.
//
//   date, vehicle, litres, meter
//   07/08/2026, ZA-7810, 30
//   07/08/2026, DAB-5905, 10, 69,370.0
//
// The seven site importers each exist because a workbook had its own shape. A
// handful of rows read off a sheet does not need any of that — it needs the
// same care about dates, plates, meters and duplicates, and none of the parsing.
//
// Dates are read DAY FIRST, as Sri Lanka writes them: 07/08/2026 is 7 August.
// Every resolved date is printed in the dry run, so a wrong reading shows up as
// a wrong month rather than hiding until someone queries the wrong week.
// ISO (2026-08-07) is accepted too and is unambiguous.
//
// Meters keep their thousand separators from the sheet — 69,370.0 — and a
// reading below the highest already held for that machine is dropped while its
// fuel is kept, because a cumulative meter never falls and the books truncate:
// Wadakada writes GE-60 as 255.4 where the machine reads 20255.4.
//
// Reconciled on (day, vehicle) count, so re-running adds nothing and a machine
// that genuinely fuelled twice in a day still gets both rows.
//
//   npx tsx scripts/add_fuel_issues.ts --site=CEP-03W --file=rows.csv
//   npx tsx scripts/add_fuel_issues.ts --site=CEP-03W --file=rows.csv --apply
//   npx tsx scripts/add_fuel_issues.ts --site=CEP-03W --row="07/08/2026,ZA-7810,30"

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const FILE = arg("file");
const SOURCE = arg("source");
const ROWS = process.argv.filter((a) => a.startsWith("--row=")).map((a) => a.slice(6));

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

function parseDate(raw: string): string {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (Number(m) > 12) throw new Error(`"${s}": month ${m} is impossible — dates are read day first`);
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  throw new Error(`cannot read the date "${s}" — use 07/08/2026 or 2026-08-07`);
}

// Sheets write meters with thousand separators, and an empty cell is not a zero.
function parseMeter(raw: string | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s || s === "-" || /^n\/?w$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type Row = { day: string; label: string; litres: number; meter: number | null };

function readRows(): Row[] {
  const lines: string[] = [...ROWS];
  if (FILE) lines.push(...fs.readFileSync(FILE, "utf8").split(/\r?\n/));
  const out: Row[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^date\b/i.test(line)) continue;                       // a heading row
    // Meters carry commas, so the split has to keep the last field whole.
    const parts = line.split(",").map((x) => x.trim());
    if (parts.length < 3) throw new Error(`not enough fields: "${line}"`);
    const day = parseDate(parts[0]);
    const label = parts[1];
    const litres = Number(parts[2].replace(/,/g, ""));
    if (!Number.isFinite(litres) || litres <= 0) throw new Error(`bad litres in "${line}"`);
    const meter = parseMeter(parts.slice(3).join(""));          // rejoin 69,370.0
    out.push({ day, label, litres, meter });
  }
  return out;
}

async function main() {
  if (!SITE) throw new Error("need --site=CODE");
  const rows = readRows();
  if (!rows.length) throw new Error("no rows — pass --file=... or --row=...");

  console.log(`\n=== add fuel to ${SITE} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();

  const project = await prisma.project.findUnique({ where: { code: SITE } });
  if (!project) throw new Error(`site ${SITE} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`${SITE} has no pump`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");
  const source = SOURCE || `${project.name} daily issue sheet`;

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const resolve = (v: string) => byCode.get(alnum(v)) ?? byReg.get(alnum(v));

  // Refuse the whole batch on an unknown plate. Registering a machine from one
  // line of a paste is how the fleet grew 88 duplicates.
  const unknown = [...new Set(rows.map((r) => r.label))].filter((l) => !resolve(l));
  if (unknown.length) {
    console.log(`\n  these are not in the fleet: ${unknown.join(", ")}`);
    console.log(`  add them first with upsert_assets.ts, or correct the spelling — nothing was written.\n`);
    throw new Error(`${unknown.length} unknown vehicle(s)`);
  }

  const days = [...new Set(rows.map((r) => r.day))].sort();
  const live = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(days[0]), lt: new Date(colombo(days[days.length - 1]).getTime() + 86400000) } },
    select: { assetId: true, issueDate: true } });
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }

  const emitted = new Map<string, number>();
  const fresh: Row[] = [];
  let skipped = 0;
  for (const r of rows) {
    const k = `${r.day}|${resolve(r.label)!.id}`;
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    if (done < already) { skipped++; continue; }
    fresh.push(r);
  }

  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: tank.fuelKind }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  if (!prices.length) throw new Error(`no ${tank.fuelKind} price on record`);
  const priceOn = (day: string) => {
    let p = prices[0];
    for (const x of prices) { if (dayOf(x.effectiveFrom) <= day) p = x; else break; }
    return p;
  };

  // Highest reading each machine already holds, so a truncated one is caught.
  const highest = new Map<string, number>();
  for (const a of new Set(fresh.map((r) => resolve(r.label)!.id))) {
    const top = await prisma.meterReading.findFirst({ where: { assetId: a }, orderBy: { value: "desc" }, select: { value: true } });
    if (top) highest.set(a, top.value);
  }

  console.log(`\n  ${rows.length} row(s) read · ${SITE} pump "${tank.name}"\n`);
  let added = 0, litres = 0, cost = 0, meters = 0;
  const dropped: string[] = [];

  for (const r of fresh) {
    const asset = resolve(r.label)!;
    let keep = r.meter;
    if (keep !== null) {
      const hi = highest.get(asset.id);
      if (hi !== undefined && keep < hi) {
        dropped.push(`${r.day} ${r.label.padEnd(10)} ${keep} is below ${hi} already held — reading dropped, fuel kept`);
        keep = null;
      } else highest.set(asset.id, keep);
    }
    const when = colombo(r.day);
    const p = priceOn(r.day);
    const c = Math.round(r.litres * p.pricePerLitre);
    added++; litres += r.litres; cost += c;
    if (keep !== null) meters++;

    console.log(`  ${r.day}  ${r.label.padEnd(10)} -> ${asset.code.padEnd(10)} ${String(r.litres).padStart(4)} L  ${rs(c).padStart(12)}  ` +
      `${keep !== null ? `${keep.toLocaleString()} ${asset.meterType}` : r.meter !== null ? "meter dropped" : "no meter"}`);

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({ data: {
        fuelKind: tank.fuelKind, litres: r.litres,
        meterReading: keep, readingType: keep !== null ? asset.meterType : null,
        pricePerLitre: p.pricePerLitre, totalCost: c,
        source, issueDate: when, issuePerson: project.name,
        assetId: asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id } });
      if (keep !== null) {
        const reading = await tx.meterReading.create({ data: {
          assetId: asset.id, value: keep, readingType: asset.meterType,
          readingDate: when, source: "FUEL_ISSUE", recordedById: admin.id, linkedIssueId: issue.id } });
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { meterReadingRecordId: reading.id } });
      }
    });
  }

  console.log(`\n  ${APPLY ? "added" : "to add"}: ${added} issue(s) · ${litres} L · ${rs(cost)}`);
  if (skipped) console.log(`  already present, left alone: ${skipped}`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters}`);
  if (dropped.length) {
    console.log(`  readings not stored (${dropped.length}):`);
    for (const d of dropped) console.log(`      ${d}`);
  }
  console.log(`  source label: "${source}"`);
  console.log(`  tank stock: ${tank.balance} L, unchanged`);
  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
