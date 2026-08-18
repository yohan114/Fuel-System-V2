import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the CEP-03 E daily fuel & lubricant log book, 01–28 July 2026.
//
// ADDITIVE, unlike the Galagedara importer — and the difference matters. The
// consolidated register already put 01–05 July on this pump: 24 rows, 862 L. Row
// for row those 24 are the same refuels the book records, same day, same vehicle,
// same litres, so replacing them would gain nothing and adding them again would
// double the week. Only 06–28 July is genuinely absent: 89 rows, 2,170 L.
//
// Two rows differ by a litre. The register has TM-14 at 31 L on 04 Jul where the
// book's transcription reads 30, and GD-7104 at 51 L on 05 Jul where it reads 50.
// The book's OWN page total for 05 Jul says 511 L against 510 in its rows — the
// book agrees with the register and the transcription is a litre short. So the
// existing rows stand and the reconciliation deliberately matches on
// (day, vehicle) COUNT rather than on litres, or those two would slip through as
// fresh rows and count the same fuel twice.
//
// The log book records no petrol, kerosene or lubricants despite having columns
// for them — all 113 rows are diesel.
//
// Meter readings are NOT imported. The workbook says plainly that odometer and
// hour-meter figures are its least reliable column ("the photographs are low
// resolution and many digits are borderline"), and consumption analytics built on
// borderline digits is worse than no analytics.
//
//   npx tsx scripts/import_cep03e_july_log.ts             # dry run
//   npx tsx scripts/import_cep03e_july_log.ts --apply
//   npx tsx scripts/import_cep03e_july_log.ts --apply --set-stock
//
// --set-stock adopts the book's closing 128 L. Off by default: the book is a
// complete self-contained July account (opens at 0, closes at 128 on 28 Jul) but
// the pump's live balance carries history from Feb onward that the book cannot
// see, so overwriting it is the user's call, not the importer's.

const APPLY = process.argv.includes("--apply");
const SET_STOCK = process.argv.includes("--set-stock");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/CEP03E_Fuel_Lubricant_Issue_Log_Jul2026.xlsx";
const PROJECT = "CEP-03E";
const SOURCE = "CEP-03 E fuel log book";

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000) ).toISOString().slice(0, 10);
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

// The photographs turn one letter into another in a handful of predictable ways.
// LD for LP is this book's signature error: LD-1709 and LD-1572 are the fleet's
// LP-1709 (DT-78) and LP-1572 (DT-67).
const variants = (s: string) => [
  s,
  s.replace(/^LD/i, "LP"), s.replace(/^GF/i, "GE"), s.replace(/^VK/i, "VR"),
  s.replace(/^ZB/i, "2B"), s.replace(/^2B/i, "ZB"),
  s.replace(/O/g, "0"), s.replace(/I/g, "1"), s.replace(/S/g, "5"),
];

// Labels that are not plates at all. The book writes them as words, and each has
// exactly one sensible home rather than a guessed vehicle.
const NON_PLATE: Record<string, { code: string; why: string }> = {
  // "CEP-03" followed by a Sinhala word — a site-level draw, not a machine. The
  // site already carries a catch-all asset for exactly this.
  "CEP-03": { code: "OTH-CEP03E", why: "site-level draw, not a machine" },
};

async function main() {
  console.log(`\n=== CEP-03 E July log book (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);

  const log = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Fuel Log"], { defval: "" })
    .filter((r) => Number(r["Diesel Qty (L)"]) > 0 && Number(r.Date) > 40000);
  const sum = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Daily Summary"], { defval: "" })
    .filter((r) => Number(r.Date) > 40000);

  const bookLitres = log.reduce((s, r) => s + Number(r["Diesel Qty (L)"]), 0);
  const received = sum.reduce((s, r) => s + (Number(r["Received (L)"]) || 0), 0);
  const closing = Number(sum[sum.length - 1]["Computed Closing (BF+Recd-Issued)"]);
  console.log(`  book: ${log.length} issues (${bookLitres} L) over ${sum.length} days · received ${received} L · closes ${closing} L`);

  const project = await prisma.project.findUnique({ where: { code: PROJECT } });
  if (!project) throw new Error(`project ${PROJECT} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`no tank for ${PROJECT}`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  // ------------------------------------------------------------ resolve fleet
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const look = (v: string) => byCode.get(alnum(v)) || byReg.get(alnum(v));

  const cats = await prisma.category.findMany({ select: { id: true, code: true, name: true } });
  const catByCode = new Map(cats.map((c) => [c.code.toUpperCase(), c]));
  const other = cats.find((c) => c.name === "Other Asset");

  const created: string[] = [];
  const cache = new Map<string, { id: string; code: string }>();
  const resolve = async (tidied: string, written: string) => {
    const ck = `${tidied}||${written}`;
    const hit0 = cache.get(ck);
    if (hit0) return hit0;

    const mapped = NON_PLATE[tidied.trim()];
    if (mapped) {
      const a = look(mapped.code);
      if (!a) throw new Error(`${tidied} maps to ${mapped.code}, which is not in the fleet`);
      cache.set(ck, a);
      return a;
    }

    for (const c of [tidied, written, ...variants(tidied), ...variants(written)]) {
      const hit = look(c);
      if (hit) { cache.set(ck, hit); return hit; }
    }

    // Unknown: register rather than drop the fuel. A descriptive label gets a
    // code built from the site, so it can never collide with a real plate.
    const label = String(tidied || written).trim();
    const code = /^[A-Z]{1,4}[-\s]?\d/i.test(label)
      ? label.toUpperCase()
      : `${(catByCode.has(label.split(/\W/)[0].toUpperCase()) ? label.split(/\W/)[0] : "PE-EWP").toUpperCase()}-CEP03E`;
    // A second run must find what the first run registered. The descriptive
    // label ("Tractor (water)") never matches the code it was given, so without
    // this the importer would mint the asset again and re-add its fuel.
    const prior = look(code);
    if (prior) { cache.set(ck, prior); return prior; }

    const cat = catByCode.get(code.split("-").slice(0, 2).join("-")) || catByCode.get(code.split("-")[0]) || other;
    if (!cat) throw new Error(`no category for ${code}`);
    created.push(`${code} — "${label}" (${cat.name})`);
    if (!APPLY) { const stub = { id: `(new:${code})`, code }; cache.set(ck, stub); return stub; }
    const made = await prisma.asset.create({ data: {
      code, regNo: null, typeLabel: `From the CEP-03 E July log book — "${label}"`,
      status: "ACTIVE", meterType: "HOURS", ownership: "OWNED",
      categoryId: cat.id, projectId: project.id } });
    byCode.set(alnum(made.code), made);
    cache.set(ck, made);
    return made;
  };

  type Row = { day: string; asset: { id: string; code: string }; litres: number };
  const parsed: Row[] = [];
  for (const r of log) {
    parsed.push({
      day: serial(Number(r.Date)),
      asset: await resolve(String(r["Vehicle No"]).trim(), String(r["Vehicle No (as written)"]).trim()),
      litres: Number(r["Diesel Qty (L)"]),
    });
  }

  // --------------------------------------------- what the pump already carries
  // Matched on (day, vehicle) count, NOT on litres — see the header. A vehicle
  // that genuinely refuelled twice in one day still gets its second row, because
  // the count, not mere existence, is what decides.
  const live = await prisma.fuelIssue.findMany({
    where: {
      bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(serial(Number(log[0].Date))), lt: new Date(colombo(serial(Number(log[log.length - 1].Date))).getTime() + 86400000) },
    },
    select: { assetId: true, issueDate: true, litres: true, source: true },
  });
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }
  console.log(`  pump already holds ${live.length} rows (${live.reduce((s, l) => s + l.litres, 0)} L) inside the book's date range`);

  // ------------------------------------------------------------ insert issues
  // A price effective "from 1 July" applies to the whole of 1 July in Colombo.
  // Comparing raw instants would put a row stored at Colombo midnight 5½ hours
  // BEFORE a price stamped T00:00:00Z that same date, and cost it at last
  // month's rate — which is how 13 rows already in this system came to sit at
  // Rs 407 in a Rs 387 month.
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  const priceOn = (day: string) => {
    let p = prices[0];
    for (const x of prices) { if (dayOf(x.effectiveFrom) <= day) p = x; else break; }
    return p;
  };

  const emitted = new Map<string, number>();
  let added = 0, litres = 0, cost = 0, skipped = 0, skippedL = 0;
  const perDay = new Map<string, { add: number; skip: number; l: number }>();

  for (const row of parsed) {
    const k = `${row.day}|${row.asset.id}`;
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    const d = perDay.get(row.day) ?? { add: 0, skip: 0, l: 0 };

    if (done < already) {
      skipped++; skippedL += row.litres; d.skip++;
      perDay.set(row.day, d);
      continue;
    }

    const when = colombo(row.day);
    const p = priceOn(row.day);
    const c = Math.round(row.litres * p.pricePerLitre);
    added++; litres += row.litres; cost += c;
    d.add++; d.l += row.litres;
    perDay.set(row.day, d);

    if (APPLY) await prisma.fuelIssue.create({ data: {
      fuelKind: "AUTO_DIESEL", litres: row.litres,
      pricePerLitre: p.pricePerLitre, totalCost: c,
      source: SOURCE, issueDate: when, issuePerson: "CEP-03 E Package",
      assetId: row.asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id,
    }});
  }

  // ------------------------------------------------------------- deliveries
  // The pump has no replenishment history at all, so every receipt the book
  // records is new. Deduped on litres+date so a re-run adds nothing.
  const liveReceipts = new Set((await prisma.bulkRequest.findMany({
    where: { bulkTankId: tank.id }, select: { requestedLitres: true, createdAt: true } }))
    .map((r) => `${r.requestedLitres}|${dayOf(r.createdAt)}`));
  let recNew = 0, recL = 0;
  for (const r of sum) {
    const l = Number(r["Received (L)"]) || 0;
    if (l <= 0) continue;
    const day = serial(Number(r.Date));
    const k = `${l}|${day}`;
    if (liveReceipts.has(k)) continue;
    liveReceipts.add(k);
    recNew++; recL += l;
    if (APPLY) await prisma.bulkRequest.create({ data: {
      fuelKind: "AUTO_DIESEL", requestedLitres: l, status: "APPROVED",
      createdAt: colombo(day), reviewedAt: colombo(day), sourceType: "OUTSIDE",
      bulkTankId: tank.id, requestedById: admin.id, reviewedById: admin.id,
      reviewNote: `Received — ${SOURCE}` } });
  }

  // ---------------------------------------------------- site arrival dates
  // A vehicle drawing from this pump belongs to this site from its first fill,
  // unless the fleet already places it here earlier.
  let asgNew = 0, asgKept = 0;
  const firstFill = new Map<string, string>();
  for (const row of parsed) {
    if (row.asset.id.startsWith("(new")) continue;
    const cur = firstFill.get(row.asset.id);
    if (!cur || row.day < cur) firstFill.set(row.asset.id, row.day);
  }
  const arrivals: string[] = [];
  for (const [assetId, day] of firstFill) {
    const existing = await prisma.assetAssignment.findFirst({
      where: { assetId, projectId: project.id }, orderBy: { startDate: "asc" } });
    if (existing) { asgKept++; continue; }
    asgNew++;
    const code = parsed.find((p) => p.asset.id === assetId)!.asset.code;
    arrivals.push(`${code} → ${day}`);
    if (APPLY) await prisma.assetAssignment.create({ data: {
      assetId, projectId: project.id, startDate: colombo(day), endDate: null,
      note: `Allocated to site — first fuel ${day} (July log book)`, createdById: admin.id } });
  }

  // ------------------------------------------------------------------ report
  console.log(`\n  day        book   already here   to add      L`);
  for (const day of [...perDay.keys()].sort()) {
    const d = perDay.get(day)!;
    console.log(`  ${day}  ${String(d.add + d.skip).padStart(5)} ${String(d.skip).padStart(13)} ${String(d.add).padStart(8)} ${String(d.l).padStart(6)}`);
  }

  // Every label the book uses and the machine it was matched to. A silent
  // mis-resolution puts one vehicle's fuel on another and nothing downstream
  // ever reveals it, so the mapping is printed in full to be checked by eye.
  console.log(`\n  book label -> fleet vehicle`);
  const seen = new Map<string, { code: string; n: number; l: number }>();
  for (const [i, r] of log.entries()) {
    const label = String(r["Vehicle No"]).trim();
    const e = seen.get(label) ?? { code: parsed[i].asset.code, n: 0, l: 0 };
    e.n++; e.l += parsed[i].litres;
    seen.set(label, e);
  }
  for (const [label, e] of [...seen].sort((a, b) => b[1].l - a[1].l)) {
    const flag = alnum(label) === alnum(e.code) ? "" : "  <-- renamed";
    console.log(`      ${label.padEnd(16)} -> ${e.code.padEnd(14)} ${String(e.n).padStart(3)} fills ${String(e.l).padStart(5)} L${flag}`);
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres} L · ${rs(cost)}`);
  console.log(`  already present, left alone: ${skipped} · ${skippedL} L`);
  console.log(`  deliveries ${APPLY ? "added" : "to add"}: ${recNew} · ${recL} L`);
  console.log(`  site arrivals: ${asgNew} new, ${asgKept} already recorded`);
  for (const a of arrivals) console.log(`      ${a}`);
  if (created.length) {
    console.log(`\n  vehicles ${APPLY ? "registered" : "to register"}:`);
    for (const c of created) console.log(`      ${c}`);
  }
  for (const [label, m] of Object.entries(NON_PLATE)) {
    console.log(`  "${label}" folded into ${m.code} — ${m.why}`);
  }

  console.log(`\n  tank stock: live ${tank.balance} L · book closes at ${closing} L on ${serial(Number(sum[sum.length - 1].Date))}`);
  if (SET_STOCK) {
    console.log(`  --set-stock given: adopting ${closing} L`);
    if (APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: closing } });
  } else {
    console.log(`  left as-is. The book is a complete July account but the pump's balance`);
    console.log(`  carries February onward, which the book cannot see. Pass --set-stock to adopt it.`);
  }

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
