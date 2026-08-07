import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the Karaitivu Bridge diesel stock book, 28 Oct 2025 – 02 Aug 2026.
//
// 360 issues (13,120 L) and 90 receipts (13,460 L), leaving the book's own
// closing balance of 340 L. It is the site's primary daily record: every line
// carries a running received/issued/balance chain and every delivery a GRN.
//
// It REPLACES the site's existing fuel rather than adding to it, because the two
// describe the same refuels. Over March–June the tank already holds 94 rows from
// the consolidated register, and vehicle by vehicle the litres agree exactly —
// 64-7131 at 770 L, BD-05 at 530 L, LB-14 at 570 L, LB-22 at 80 L and ten others
// match to the litre. Where they differ, the register is short: 355 L against the
// book's 1,635 L in March, and 940 L against 3,010 L for the Lanka Pile
// generator. Adding would double every month the two share.
//
// Three of the register's labels are the book's under another name, and the
// replacement is what folds them back together:
//   Generator (Lanka Pile)   -> GEN-KB, whose type is literally "Generator (Sub, Lanka Pile)"
//   Crane (Lanka Pile)       -> OTH-KB, "Crane (Sub, Lanka Pile)"
//   LK-5141                  -> the book's LK-5041, which is BM-05's plate
//
// Meters are kept only while they advance. A ten-month handwritten book will
// carry a few readings that go backwards, and stopping the whole import for one
// of them helps nobody — so a reading below the highest already accepted for that
// machine is dropped, its fuel is kept, and every one is listed.
//
//   npx tsx scripts/import_karaitivu_stock_book.ts             # dry run
//   npx tsx scripts/import_karaitivu_stock_book.ts --apply
//   npx tsx scripts/import_karaitivu_stock_book.ts --apply --set-stock

const APPLY = process.argv.includes("--apply");
const SET_STOCK = process.argv.includes("--set-stock");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/Karaitivu_Diesel_Stock_Book.xlsx";
const PROJECT = "KARA";
const SOURCE = "Karaitivu diesel stock book";

// Descriptions that are not plates. Each already exists in the fleet under a
// name only a human would connect to the book's wording.
const LABEL_MAP: Record<string, string> = {
  "Generator (Lanka Pile)": "GEN-KB",
  "GE-118 (for lanka pile)": "GE-118",
  "Crane (Lanka Pile)": "OTH-KB",
};

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

// The book writes 2025.10.28, and once 2026.02.10. with a trailing stop. A
// stricter pattern silently dropped that day's 20 L delivery and left the
// received total 20 L short of the book's own.
function toISO(v: unknown): string | null {
  const m = String(v).trim().replace(/[.\-/]+$/, "").match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const n = Number(v);
  if (Number.isFinite(n) && n > 40000 && n < 60000)
    return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  return null;
}

async function main() {
  console.log(`\n=== Karaitivu diesel stock book (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);
  const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Diesel Stock Book"], { header: 1, defval: "", blankrows: false });

  type Issue = { day: string; label: string; litres: number; meter: number | null };
  type Receipt = { day: string; litres: number; grn: string; from: string };
  const issues: Issue[] = [];
  const receipts: Receipt[] = [];
  for (const r of raw) {
    const day = toISO(r[1]);
    if (!day) continue;                       // the TOTAL row and the headings
    const out = Number(r[11]), inn = Number(r[6]), meter = Number(r[8]);
    if (Number.isFinite(out) && out > 0) {
      issues.push({ day, label: String(r[3]).trim(), litres: out,
        meter: Number.isFinite(meter) && meter > 0 ? meter : null });
    }
    if (Number.isFinite(inn) && inn > 0) {
      receipts.push({ day, litres: inn, grn: String(r[2]).trim(), from: String(r[3]).trim() });
    }
  }
  issues.sort((a, b) => a.day.localeCompare(b.day));
  const issuedTotal = issues.reduce((s, i) => s + i.litres, 0);
  const receivedTotal = receipts.reduce((s, r) => s + r.litres, 0);
  const closing = receivedTotal - issuedTotal;
  console.log(`  book: ${issues.length} issues (${issuedTotal} L) · ${receipts.length} receipts (${receivedTotal} L)`);
  console.log(`  ${issues[0].day} .. ${issues[issues.length - 1].day} · received − issued = ${closing} L`);

  const project = await prisma.project.findUnique({ where: { code: PROJECT } });
  if (!project) throw new Error(`project ${PROJECT} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`no tank for ${PROJECT}`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  // ------------------------------------------------------------ resolve fleet
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const look = (v: string) => byCode.get(alnum(v)) || byReg.get(alnum(v));
  const cats = await prisma.category.findMany({ select: { id: true, code: true, name: true } });
  const catByCode = new Map(cats.map((c) => [c.code.toUpperCase(), c]));
  const other = cats.find((c) => c.name === "Other Asset");
  if (!other) throw new Error(`no "Other Asset" category`);

  // A unit whose reading advances further in a day than a day has hours is on a
  // distance meter, not an hour meter.
  const span = new Map<string, { min: number; max: number; days: Set<string> }>();
  for (const i of issues) {
    if (i.meter === null) continue;
    const e = span.get(i.label) ?? { min: i.meter, max: i.meter, days: new Set<string>() };
    e.min = Math.min(e.min, i.meter); e.max = Math.max(e.max, i.meter); e.days.add(i.day);
    span.set(i.label, e);
  }
  const guessMeter = (label: string) => {
    const e = span.get(label);
    if (!e || e.days.size < 2) return "HOURS";
    return (e.max - e.min) > 24 * e.days.size ? "KM" : "HOURS";
  };

  const created: string[] = [];
  const resolved = new Map<string, { id: string; code: string; meterType: string }>();
  for (const label of [...new Set(issues.map((i) => i.label))]) {
    const target = LABEL_MAP[label];
    const hit = target ? look(target) : look(label);
    if (hit) { resolved.set(label, hit); continue; }
    if (target) throw new Error(`${label} maps to ${target}, which is not in the fleet`);
    const meterType = guessMeter(label);
    const cat = catByCode.get(label.split(/[-\s]/)[0].toUpperCase()) ?? other;
    created.push(`${label} (${cat.name}, ${meterType})`);
    if (!APPLY) { resolved.set(label, { id: `(new:${label})`, code: label, meterType }); continue; }
    const made = await prisma.asset.create({ data: {
      code: label, regNo: /^[A-Z]{2,3}-?\d{3,4}$/i.test(label) ? label : null,
      typeLabel: "From the Karaitivu diesel stock book",
      status: "ACTIVE", meterType, ownership: "OWNED",
      categoryId: cat.id, projectId: project.id } });
    byCode.set(alnum(made.code), made);
    resolved.set(label, made);
  }

  // ---------------------------------------------- retire the superseded rows
  const from = colombo(issues[0].day);
  const to = new Date(colombo(issues[issues.length - 1].day).getTime() + 86400000);
  const superseded = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, issueDate: { gte: from, lt: to } },
    select: { id: true, litres: true, source: true } });
  const bySrc = new Map<string, { n: number; l: number }>();
  for (const s of superseded) {
    const e = bySrc.get(s.source) ?? { n: 0, l: 0 };
    e.n++; e.l += s.litres;
    bySrc.set(s.source, e);
  }
  console.log(`\n  superseded rows to remove: ${superseded.length} (${superseded.reduce((s, x) => s + x.litres, 0)} L)`);
  for (const [s, v] of bySrc) console.log(`      ${v.n} rows / ${v.l} L from "${s}"`);
  const outside = await prisma.fuelIssue.count({ where: { bulkTankId: tank.id, NOT: { issueDate: { gte: from, lt: to } } } });
  console.log(`  rows kept (outside the book's dates): ${outside}`);
  if (APPLY && superseded.length) {
    const ids = superseded.map((s) => s.id);
    // Readings hang off the issues by an optional link, so deleting the issues
    // alone would leave the readings behind pointing at nothing.
    await prisma.meterReading.deleteMany({ where: { linkedIssueId: { in: ids } } });
    await prisma.fuelIssue.deleteMany({ where: { id: { in: ids } } });
  }

  // ------------------------------------------------------------ price + insert
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  const priceOn = (day: string) => {
    let p = prices[0];
    for (const x of prices) { if (dayOf(x.effectiveFrom) <= day) p = x; else break; }
    return p;
  };

  // Walking in date order, a reading is accepted only if it is at least the
  // highest already accepted for that machine.
  const highest = new Map<string, number>();
  const dropped: string[] = [];
  let added = 0, litres = 0, cost = 0, meters = 0;

  for (const row of issues) {
    const asset = resolved.get(row.label)!;
    let keep = row.meter;
    if (keep !== null) {
      const hi = highest.get(asset.id);
      if (hi !== undefined && keep < hi) {
        dropped.push(`${row.day} ${row.label.padEnd(22)} ${keep} after ${hi}`);
        keep = null;
      } else highest.set(asset.id, keep);
    }
    const when = colombo(row.day);
    const p = priceOn(row.day);
    const c = Math.round(row.litres * p.pricePerLitre);
    added++; litres += row.litres; cost += c;
    if (keep !== null) meters++;
    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({ data: {
        fuelKind: "AUTO_DIESEL", litres: row.litres,
        meterReading: keep, readingType: keep !== null ? asset.meterType : null,
        pricePerLitre: p.pricePerLitre, totalCost: c,
        source: SOURCE, issueDate: when, issuePerson: "Karaitivu Bridge",
        assetId: asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id } });
      if (keep !== null) {
        const reading = await tx.meterReading.create({ data: {
          assetId: asset.id, value: keep, readingType: asset.meterType,
          readingDate: when, source: "FUEL_ISSUE", recordedById: admin.id, linkedIssueId: issue.id } });
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { meterReadingRecordId: reading.id } });
      }
    });
  }

  // --------------------------------------------------------------- deliveries
  const liveReceipts = new Set((await prisma.bulkRequest.findMany({
    where: { bulkTankId: tank.id }, select: { requestedLitres: true, createdAt: true } }))
    .map((r) => `${r.requestedLitres}|${dayOf(r.createdAt)}`));
  let recNew = 0, recL = 0;
  for (const r of receipts) {
    const k = `${r.litres}|${r.day}`;
    if (liveReceipts.has(k)) continue;
    liveReceipts.add(k);
    recNew++; recL += r.litres;
    if (APPLY) await prisma.bulkRequest.create({ data: {
      fuelKind: "AUTO_DIESEL", requestedLitres: r.litres, status: "APPROVED",
      createdAt: colombo(r.day), reviewedAt: colombo(r.day), sourceType: "OUTSIDE",
      bulkTankId: tank.id, requestedById: admin.id, reviewedById: admin.id,
      reviewNote: `${r.from}${r.grn ? ` — GRN ${r.grn}` : ""}` } });
  }

  // ------------------------------------------------------------------ report
  console.log(`\n  book label -> fleet machine`);
  for (const label of [...new Set(issues.map((i) => i.label))]
    .sort((a, b) => issues.filter((i) => i.label === b).reduce((s, i) => s + i.litres, 0)
                  - issues.filter((i) => i.label === a).reduce((s, i) => s + i.litres, 0))) {
    const mine = issues.filter((i) => i.label === label);
    const a = resolved.get(label)!;
    const isNew = created.some((c) => c.startsWith(label + " "));
    console.log(`      ${label.padEnd(24)} -> ${a.code.padEnd(10)} ${String(mine.length).padStart(3)} lines ${String(mine.reduce((s, i) => s + i.litres, 0)).padStart(5)} L` +
      `${isNew ? "   [NEW machine]" : LABEL_MAP[label] ? "   [named differently in the fleet]" : ""}`);
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres} L · ${rs(cost)}`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters}`);
  if (dropped.length) {
    console.log(`  readings dropped for going backwards (${dropped.length}) — the fuel is kept:`);
    for (const d of dropped.slice(0, 15)) console.log(`      ${d}`);
    if (dropped.length > 15) console.log(`      … and ${dropped.length - 15} more`);
  }
  console.log(`  deliveries ${APPLY ? "added" : "to add"}: ${recNew} · ${recL} L`);
  if (created.length) {
    console.log(`\n  machines ${APPLY ? "registered" : "to register"} (${created.length}):`);
    for (const c of created) console.log(`      ${c}`);
  }

  const months = new Map<string, number>();
  for (const i of issues) months.set(i.day.slice(0, 7), (months.get(i.day.slice(0, 7)) || 0) + i.litres);
  console.log(`\n  month by month:`);
  for (const [m, l] of [...months].sort()) console.log(`      ${m}  ${String(l).padStart(6)} L`);

  console.log(`\n  tank stock: live ${tank.balance} L · book closes at ${closing} L`);
  if (SET_STOCK) {
    console.log(`  --set-stock given: adopting ${closing} L`);
    if (APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: closing } });
  } else {
    console.log(`  left as-is — pass --set-stock to adopt the book's figure.`);
  }

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
