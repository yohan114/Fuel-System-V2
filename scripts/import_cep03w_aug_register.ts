import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the CEP-03 Wadakada daily fuel issue register, 01–06 August 2026.
//
// 32 issue lines, 634 L, from six handwritten daily notes. The pump holds nothing
// on or after 1 August, so every line is new.
//
// The book proves itself: 234 L opening + 800 L received − 634 L issued = 400 L
// closing, and every daily total re-adds to the storekeeper's written figure with
// zero variance across all six days. That is a stronger stock account than any
// other register imported here, which is why --set-stock is worth using on it.
//
// METERS ARE FILTERED BY THE BOOK'S OWN CONFIDENCE COLUMN. Only High and Medium
// readings are stored. The Low ones are not stored because the transcriber marks
// them "Do not use for costing until verified", and two are visibly truncated —
// GE-60 reads 251.4 against 20253.3 two days later, LD-09 reads 688 against
// 20060.8 three days earlier. A wrong meter does not announce itself: it silently
// poisons every consumption rate computed from it afterwards. The fuel on those
// lines is still imported; only the reading is left out.
//
// NO CHARACTER-SUBSTITUTION GUESSING. The workbook already normalises its own
// spellings, and the near-misses here are traps: ZB-8395 is one character from
// CR-01 (ZA-8395) but carries meter 9278 on the same day CR-01 reads 3275, so it
// is a different machine; LN-8288 is one character from BM-04 (LN-8278) but drew
// 2 L, which is a hand tool, not a boom truck; LP-1575 is one character from
// eight different tippers. Anything unrecognised is registered as a new machine
// rather than folded into a plausible one.
//
//   npx tsx scripts/import_cep03w_aug_register.ts             # dry run
//   npx tsx scripts/import_cep03w_aug_register.ts --apply
//   npx tsx scripts/import_cep03w_aug_register.ts --apply --set-stock

const APPLY = process.argv.includes("--apply");
const SET_STOCK = process.argv.includes("--set-stock");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/CEP03W_Fuel_Issue_Register_Aug2026.xlsx";
const PROJECT = "CEP-03W";
const SOURCE = "CEP-03 Wadakada fuel register";
// The book's own word for a reading it does not stand behind.
const TRUSTED_CONFIDENCE = new Set(["high", "medium"]);

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());

async function main() {
  console.log(`\n=== CEP-03 Wadakada August register (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);
  const sheet = (n: string) => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, defval: "" });

  // Sub-total and grand-total lines carry text in the date column, so requiring a
  // real date is enough to keep them out.
  const raw = sheet("Fuel Issue Register").filter((r) => isDate(r[0]) && Number(r[5]) > 0);
  const recon = sheet("Daily Stock Reconciliation").filter((r) => isDate(r[0]));

  const bookLitres = raw.reduce((s, r) => s + Number(r[5]), 0);
  const received = recon.reduce((s, r) => s + (Number(r[3]) || 0), 0);
  const opening = Number(recon[0][2]);
  const closing = Number(recon[recon.length - 1][9]);
  console.log(`  book: ${raw.length} issues · ${bookLitres} L · ${raw[0][0]} .. ${raw[raw.length - 1][0]}`);
  console.log(`  stock chain: ${opening} L opening + ${received} L received − ${bookLitres} L issued = ${closing} L closing`);
  if (opening + received - bookLitres !== closing) console.log(`  ! that chain does not balance — check the reconciliation sheet`);

  const project = await prisma.project.findUnique({ where: { code: PROJECT } });
  if (!project) throw new Error(`project ${PROJECT} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`no tank for ${PROJECT}`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  // ------------------------------------------------------------ resolve fleet
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true, projectId: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const look = (v: string) => byCode.get(alnum(v)) || byReg.get(alnum(v));
  const cats = await prisma.category.findMany({ select: { id: true, code: true, name: true } });
  const catByCode = new Map(cats.map((c) => [c.code.toUpperCase(), c]));
  const other = cats.find((c) => c.name === "Other Asset");
  if (!other) throw new Error(`no "Other Asset" category to register unknown machines under`);

  type Row = { day: string; label: string; written: string; litres: number; meter: number | null; confidence: string; note: string };
  const parsed: Row[] = raw.map((r) => {
    const m = Number(r[6]);
    return {
      day: String(r[0]).trim(),
      label: String(r[4]).trim() || String(r[3]).trim(),
      written: String(r[3]).trim(),
      litres: Number(r[5]),
      meter: Number.isFinite(m) && m > 0 ? m : null,
      confidence: String(r[7]).trim().toLowerCase(),
      note: String(r[10] || "").trim(),
    };
  });

  // A machine's meter type is decided by what its own readings do. A unit whose
  // reading advances further in a day than a day has hours cannot be on an hour
  // meter — DAB-5905 moves 741 units in five days, which is kilometres.
  const movement = new Map<string, { min: number; max: number; days: Set<string> }>();
  for (const p of parsed) {
    if (p.meter === null) continue;
    const e = movement.get(p.label) ?? { min: p.meter, max: p.meter, days: new Set<string>() };
    e.min = Math.min(e.min, p.meter); e.max = Math.max(e.max, p.meter); e.days.add(p.day);
    movement.set(p.label, e);
  }
  const guessMeterType = (label: string) => {
    const e = movement.get(label);
    if (!e || e.days.size < 2) return "HOURS";
    return (e.max - e.min) > 24 * e.days.size ? "KM" : "HOURS";
  };

  const created: string[] = [];
  const resolved = new Map<string, { id: string; code: string; meterType: string; projectId: string | null }>();
  for (const label of [...new Set(parsed.map((p) => p.label))]) {
    const written = parsed.find((p) => p.label === label)!.written;
    const hit = look(label) ?? look(written);
    if (hit) { resolved.set(label, hit); continue; }
    const meterType = guessMeterType(label);
    const cat = catByCode.get(label.split(/[-\s]/)[0].toUpperCase()) ?? other;
    created.push(`${label} (${cat.name}, ${meterType})`);
    if (!APPLY) { resolved.set(label, { id: `(new:${label})`, code: label, meterType, projectId: project.id }); continue; }
    const made = await prisma.asset.create({ data: {
      code: label, regNo: /^[A-Z]{2,3}-?\d{3,4}$/i.test(label) ? label : null,
      typeLabel: `From the CEP-03 Wadakada August register`,
      status: "ACTIVE", meterType, ownership: "OWNED",
      categoryId: cat.id, projectId: project.id } });
    byCode.set(alnum(made.code), made);
    resolved.set(label, made);
  }

  // ------------------------------------------- what the pump already carries
  const live = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(parsed[0].day), lt: new Date(colombo(parsed[parsed.length - 1].day).getTime() + 86400000) } },
    select: { assetId: true, issueDate: true } });
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }
  const emitted = new Map<string, number>();
  const fresh: Row[] = [];
  let skipped = 0;
  for (const row of parsed) {
    const k = `${row.day}|${resolved.get(row.label)!.id}`;
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    if (done < already) { skipped++; continue; }
    fresh.push(row);
  }
  console.log(`  pump already holds ${live.length} row(s) in that window\n`);

  // ------------------------------------------------------------- meter checks
  // Readings are merged into the machine's EXISTING timeline before being judged,
  // not compared against its highest value. This register back-fills: CR-01 reads
  // 3275 here on 1 August and already holds 3280 through 3306 from the CEP-03 E
  // book, which is a correct sequence and would look like a reversal to anything
  // that only compared against the latest.
  const bad: string[] = [];
  const usable = fresh.filter((r) => r.meter !== null && TRUSTED_CONFIDENCE.has(r.confidence));
  for (const label of new Set(usable.map((r) => r.label))) {
    const asset = resolved.get(label)!;
    const existing = asset.id.startsWith("(new") ? [] : await prisma.meterReading.findMany({
      where: { assetId: asset.id }, select: { value: true, readingDate: true } });
    const timeline = [
      ...existing.map((e) => ({ day: dayOf(e.readingDate), value: e.value, from: "system" })),
      ...usable.filter((r) => r.label === label).map((r) => ({ day: r.day, value: r.meter!, from: "book" })),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.value - b.value);
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].value < timeline[i - 1].value) {
        bad.push(`${label}: ${timeline[i].day} reads ${timeline[i].value} (${timeline[i].from}) after ${timeline[i - 1].value} on ${timeline[i - 1].day} (${timeline[i - 1].from})`);
      }
    }
  }
  if (bad.length) {
    console.log(`  METER READINGS GO BACKWARDS — nothing written:`);
    for (const b of bad) console.log(`      ${b}`);
    throw new Error("correct the readings in the sheet, then re-run");
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

  let added = 0, litres = 0, cost = 0, meters = 0;
  const droppedMeters: string[] = [];
  for (const row of fresh) {
    const asset = resolved.get(row.label)!;
    const keepMeter = row.meter !== null && TRUSTED_CONFIDENCE.has(row.confidence);
    if (row.meter !== null && !keepMeter) {
      droppedMeters.push(`${row.day} ${row.label} ${row.meter} (${row.confidence || "no confidence given"})${row.note ? ` — ${row.note}` : ""}`);
    }
    const when = colombo(row.day);
    const p = priceOn(row.day);
    const c = Math.round(row.litres * p.pricePerLitre);
    added++; litres += row.litres; cost += c;
    if (keepMeter) meters++;
    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({ data: {
        fuelKind: "AUTO_DIESEL", litres: row.litres,
        meterReading: keepMeter ? row.meter : null, readingType: keepMeter ? asset.meterType : null,
        pricePerLitre: p.pricePerLitre, totalCost: c,
        source: SOURCE, issueDate: when, issuePerson: "CEP-03 Wadakada",
        assetId: asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id,
      }});
      if (keepMeter) {
        const reading = await tx.meterReading.create({ data: {
          assetId: asset.id, value: row.meter!, readingType: asset.meterType,
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
  for (const r of recon) {
    const l = Number(r[3]) || 0;
    if (l <= 0) continue;
    const day = String(r[0]).trim();
    if (liveReceipts.has(`${l}|${day}`)) continue;
    liveReceipts.add(`${l}|${day}`);
    recNew++; recL += l;
    if (APPLY) await prisma.bulkRequest.create({ data: {
      fuelKind: "AUTO_DIESEL", requestedLitres: l, status: "APPROVED",
      createdAt: colombo(day), reviewedAt: colombo(day), sourceType: "OUTSIDE",
      bulkTankId: tank.id, requestedById: admin.id, reviewedById: admin.id,
      reviewNote: `Received — ${SOURCE}` } });
  }

  // ------------------------------------------------------------------ report
  console.log(`  book label -> fleet vehicle`);
  for (const label of [...new Set(parsed.map((p) => p.label))].sort()) {
    const rows = parsed.filter((p) => p.label === label);
    const a = resolved.get(label)!;
    const kept = rows.filter((r) => r.meter !== null && TRUSTED_CONFIDENCE.has(r.confidence)).length;
    const isNew = a.id.startsWith("(new") || created.some((c) => c.startsWith(label + " "));
    console.log(`      ${label.padEnd(10)} -> ${a.code.padEnd(10)} ${String(rows.length).padStart(2)} lines ${String(rows.reduce((s, r) => s + r.litres, 0)).padStart(3)} L · ` +
      `${kept} meter(s) kept of ${rows.filter((r) => r.meter !== null).length}${isNew ? "   [NEW machine]" : ""}`);
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres} L · ${rs(cost)}`);
  if (skipped) console.log(`  already present, left alone: ${skipped}`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters}`);
  if (droppedMeters.length) {
    console.log(`  meter readings NOT stored (${droppedMeters.length}) — the book does not stand behind them:`);
    for (const d of droppedMeters) console.log(`      ${d}`);
  }
  console.log(`  deliveries ${APPLY ? "added" : "to add"}: ${recNew} · ${recL} L`);
  if (created.length) {
    console.log(`\n  machines ${APPLY ? "registered" : "to register"} (${created.length}) — none matched the fleet:`);
    for (const c of created) console.log(`      ${c}`);
  }

  console.log(`\n  tank stock: live ${tank.balance} L · book closes at ${closing} L on ${recon[recon.length - 1][0]}`);
  if (SET_STOCK) {
    console.log(`  --set-stock given: adopting ${closing} L`);
    if (APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: closing } });
  } else {
    console.log(`  left as-is. This book's chain proves itself over six days with zero variance,`);
    console.log(`  so ${closing} L is well evidenced — pass --set-stock to adopt it.`);
  }

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
