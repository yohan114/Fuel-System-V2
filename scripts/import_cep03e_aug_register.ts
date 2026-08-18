import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the CEP-03 E daily fuel issue register, 01–06 August 2026.
//
// Twenty rows, 500 L, transcribed from six handwritten daily sheets. The site
// holds nothing on or after 1 August, so every row is new and there is no
// overlap to reconcile against — unlike the July book, where the consolidated
// register had already covered the first week.
//
// METER READINGS ARE IMPORTED, which the July book's were not. That book stated
// its odometer column was its least reliable field and many digits were
// borderline; this one records a meter on 9 of 20 lines, gives the previous
// reading beside each, and computes the running hours between them. Only the
// CURRENT meter is stored: a previous reading is the prior row's current one,
// and writing both would invent readings the book never took.
//
// Each reading becomes a MeterReading linked back to its issue, the same shape
// the workshop console produces, so the fleet page and consumption analytics
// see them exactly as if an operator had keyed them in.
//
// Two plates are one digit out and resolve to a single candidate each:
//   ZA-7610 -> TM-14 (ZA-7810), which the site's July book also fuelled
//   ZA-9033 -> TM-16 (ZA-8033)
// ZA-8395 is NOT one of those. It is an exact plate match for CR-01, Badalgama's
// mobile crane, and its meter climbs 3280 to 3306 across the week — twenty-six
// hours of work, not a misreading of the site's own ZA-6395.
//
// Vehicles posted to another site (CR-01 at Badalgama, HEX-05 at Lot-04) get
// their fuel recorded here and NOTHING ELSE. A workshop pump may fuel anything
// that drives up to it; giving those two an open-ended CEP-03 E posting would
// move them off the site they actually work on.
//
//   npx tsx scripts/import_cep03e_aug_register.ts             # dry run
//   npx tsx scripts/import_cep03e_aug_register.ts --apply
//   npx tsx scripts/import_cep03e_aug_register.ts --apply --decrement-stock

const APPLY = process.argv.includes("--apply");
const DECREMENT = process.argv.includes("--decrement-stock");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/CEP03E_Daily_Fuel_Issue_Register_Aug2026.xlsx";
const PROJECT = "CEP-03E";
const SOURCE = "CEP-03 E daily fuel register";

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)).toISOString().slice(0, 10);
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

async function main() {
  console.log(`\n=== CEP-03 E August fuel register (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);
  const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Fuel Issue Register"], { header: 1, defval: "" })
    .filter((r) => Number(r[1]) > 40000 && Number(r[6]) > 0);   // the TOTAL row has no date

  const bookLitres = raw.reduce((s, r) => s + Number(r[6]), 0);
  console.log(`  book: ${raw.length} issues · ${bookLitres} L · ${serial(Number(raw[0][1]))} .. ${serial(Number(raw[raw.length - 1][1]))}`);

  const project = await prisma.project.findUnique({ where: { code: PROJECT } });
  if (!project) throw new Error(`project ${PROJECT} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`no tank for ${PROJECT}`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  // ------------------------------------------------------------ resolve fleet
  const assets = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true, projectId: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const look = (v: string) => byCode.get(alnum(v)) || byReg.get(alnum(v));

  // A handwritten plate loses one digit at a time — 6 read as 8, 1 as 7. Try the
  // exact string first and only then single-digit substitutions, and accept the
  // result only when exactly ONE machine in the fleet is a candidate. Two
  // candidates is a coin toss, and a coin toss puts one vehicle's fuel on
  // another's record where nothing downstream will ever reveal it.
  function resolve(label: string) {
    const direct = look(label);
    if (direct) return { asset: direct, how: "exact" as const };
    const cands = new Map<string, typeof assets[number]>();
    for (let i = 0; i < label.length; i++) {
      if (!/\d/.test(label[i])) continue;
      for (const d of "0123456789") {
        if (d === label[i]) continue;
        const hit = look(label.slice(0, i) + d + label.slice(i + 1));
        if (hit) cands.set(hit.id, hit);
      }
    }
    if (cands.size === 1) return { asset: [...cands.values()][0], how: "one digit out" as const };
    if (cands.size > 1) throw new Error(`"${label}" could be any of ${[...cands.values()].map((a) => a.code).join(", ")} — resolve by hand`);
    throw new Error(`"${label}" matches nothing in the fleet`);
  }

  type Row = { day: string; label: string; asset: typeof assets[number]; how: string; litres: number; meter: number | null; remark: string };
  const parsed: Row[] = raw.map((r) => {
    const label = String(r[4]).trim();
    const { asset, how } = resolve(label);
    const meter = Number(r[7]);
    return {
      day: serial(Number(r[1])), label, asset, how,
      litres: Number(r[6]),
      meter: Number.isFinite(meter) && meter > 0 ? meter : null,
      remark: String(r[13] || "").trim(),
    };
  });

  // ------------------------------------------------- what the pump already has
  // Matched on (day, vehicle) count, so a re-run adds nothing and a vehicle that
  // genuinely fuelled twice in a day still gets both rows.
  const live = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(parsed[0].day), lt: new Date(colombo(parsed[parsed.length - 1].day).getTime() + 86400000) } },
    select: { assetId: true, issueDate: true, litres: true } });
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }
  console.log(`  pump already holds ${live.length} row(s) in that window`);

  // Which rows are genuinely new. Settled BEFORE the meter check, because a row
  // already imported has already contributed its reading — checking it against
  // itself would report the book as going backwards on every re-run.
  const emitted = new Map<string, number>();
  const fresh: Row[] = [];
  let skipped = 0;
  for (const row of parsed) {
    const k = `${row.day}|${row.asset.id}`;
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    if (done < already) { skipped++; continue; }
    fresh.push(row);
  }

  // ------------------------------------------- meter sanity, before any writing
  // A cumulative meter cannot go backwards. The console refuses such an entry;
  // an importer that does not check would write in bulk what the UI blocks one
  // row at a time.
  const problems: string[] = [];
  for (const [id, rows] of groupBy(fresh.filter((p) => p.meter !== null), (p) => p.asset.id)) {
    const latest = await prisma.meterReading.findFirst({
      where: { assetId: id }, orderBy: [{ value: "desc" }], select: { value: true, readingDate: true } });
    const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
    if (latest && sorted[0].meter! < latest.value) {
      problems.push(`${sorted[0].asset.code}: book opens at ${sorted[0].meter} but the system already holds ${latest.value} (${dayOf(latest.readingDate)})`);
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].meter! < sorted[i - 1].meter!) {
        problems.push(`${sorted[i].asset.code}: ${sorted[i].day} reads ${sorted[i].meter} after ${sorted[i - 1].meter} on ${sorted[i - 1].day}`);
      }
    }
  }
  if (problems.length) {
    console.log(`\n  METER READINGS GO BACKWARDS — nothing will be written:`);
    for (const p of problems) console.log(`      ${p}`);
    throw new Error("resolve the readings above, or re-run with the offending rows corrected in the sheet");
  }

  // ------------------------------------------------------------ price + insert
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  // A price effective "from 1 July" covers the whole of 1 July in Colombo; the
  // raw instants would put a row stored at Colombo midnight 5½ hours before it.
  const priceOn = (day: string) => {
    let p = prices[0];
    for (const x of prices) { if (dayOf(x.effectiveFrom) <= day) p = x; else break; }
    return p;
  };

  let added = 0, litres = 0, cost = 0, meters = 0;

  for (const row of fresh) {
    const when = colombo(row.day);
    const p = priceOn(row.day);
    const c = Math.round(row.litres * p.pricePerLitre);
    added++; litres += row.litres; cost += c;
    if (row.meter !== null) meters++;

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({ data: {
        fuelKind: "AUTO_DIESEL", litres: row.litres,
        meterReading: row.meter, readingType: row.meter !== null ? row.asset.meterType : null,
        pricePerLitre: p.pricePerLitre, totalCost: c,
        source: SOURCE, issueDate: when, issuePerson: "CEP-03 E Package",
        assetId: row.asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id,
      }});
      if (row.meter !== null) {
        const reading = await tx.meterReading.create({ data: {
          assetId: row.asset.id, value: row.meter, readingType: row.asset.meterType,
          readingDate: when, source: "FUEL_ISSUE", recordedById: admin.id, linkedIssueId: issue.id,
        }});
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { meterReadingRecordId: reading.id } });
      }
    });
  }

  // ---------------------------------------------------- site arrival dates
  // Only for machines this site can claim: ones already posted here, or posted
  // nowhere at all. A vehicle that belongs to another site was a visitor at this
  // pump, and recording an open-ended posting would quietly re-site it.
  let asgNew = 0;
  const visitors: string[] = [];
  const firstFill = new Map<string, string>();
  for (const r of parsed) {
    const cur = firstFill.get(r.asset.id);
    if (!cur || r.day < cur) firstFill.set(r.asset.id, r.day);
  }
  for (const [assetId, day] of firstFill) {
    const asset = assets.find((a) => a.id === assetId)!;
    if (asset.projectId && asset.projectId !== project.id) {
      const home = await prisma.project.findUnique({ where: { id: asset.projectId }, select: { code: true } });
      visitors.push(`${asset.code} (posted to ${home?.code}) — fuel recorded, posting untouched`);
      continue;
    }
    const existing = await prisma.assetAssignment.findFirst({ where: { assetId, projectId: project.id } });
    if (existing) continue;
    asgNew++;
    if (APPLY) await prisma.assetAssignment.create({ data: {
      assetId, projectId: project.id, startDate: colombo(day), endDate: null,
      note: `Allocated to site — first fuel ${day} (August register)`, createdById: admin.id } });
  }

  // ------------------------------------------------------------------ report
  console.log(`\n  book label -> fleet vehicle`);
  for (const [label, rows] of groupBy(parsed, (p) => p.label)) {
    const a = rows[0].asset;
    const m = rows.filter((r) => r.meter !== null);
    console.log(`      ${label.padEnd(10)} -> ${a.code.padEnd(10)} ${String(rows.length).padStart(2)} rows ${String(rows.reduce((s, r) => s + r.litres, 0)).padStart(4)} L · ` +
      `${m.length ? `${m.length} meter${m.length > 1 ? "s" : ""} ${Math.min(...m.map((r) => r.meter!))}–${Math.max(...m.map((r) => r.meter!))} ${a.meterType}` : "no meter"}` +
      `${rows[0].how === "exact" ? "" : `   [${rows[0].how}]`}`);
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres} L · ${rs(cost)}`);
  if (skipped) console.log(`  already present, left alone: ${skipped}`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters} of ${parsed.length} lines`);
  console.log(`  site arrivals ${APPLY ? "recorded" : "to record"}: ${asgNew}`);
  for (const v of visitors) console.log(`      visitor: ${v}`);

  const after = tank.balance - litres;
  console.log(`\n  tank stock: ${tank.balance} L${DECREMENT ? ` -> ${after} L` : `  (unchanged — pass --decrement-stock to take ${litres} L off)`}`);
  if (DECREMENT && APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: after } });

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return m;
}

main().finally(() => prisma.$disconnect());
