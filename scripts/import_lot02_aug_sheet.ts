import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the Batticaloa ICDP Lot-02 daily fuel issuing sheets, 01–03 Aug 2026.
//
// This form is shaped differently from the other sites'. One sheet line can hold
// TWO issues — a 1st and a 2nd Fuel Qty, each with its own meter — so 49 lines
// carry 60 refuels totalling 835 L. They are stored as 60 rows rather than 49
// summed ones, because the meters pair with the fills and summing would throw
// half of them away.
//
// The tank holds nothing on or after 1 August, so this is purely additive.
//
// No stock is touched: the sheets' Today Received / Today Issue / Today Balance
// footer boxes are blank on all three days, so there is nothing to reconcile
// against and no closing figure to adopt.
//
// The sheet's own Vehicle Category column is used when a machine has to be
// registered — "JCB" becomes a Backhoe Loader, "Bob Cat" a Skid Steer, "Bolero"
// a Double Cab. It is better evidence of what a machine is than the catch-all,
// and a wrong category attaches a wrong PM schedule.
//
//   npx tsx scripts/import_lot02_aug_sheet.ts             # dry run
//   npx tsx scripts/import_lot02_aug_sheet.ts --apply

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/Batticaloa_Lot02_Fuel_Issue_Aug2026.xlsx";
const PROJECT = "BATTI-02";
const SOURCE = "Lot-02 daily fuel issuing sheet";

// The workbook's Transcription Notes settle this one: "Almost certainly the same
// 1 Cub. Written LL on 01/08 and 03/08 and LK on 02/08."
const LABEL_MAP: Record<string, string> = { "LK-0936": "LL-0936" };

// Readings the transcriber says are not whole numbers off the sheet. Taken from
// the Transcription Notes rather than guessed from the remark text, so the reason
// each is dropped can be checked against the source. The fuel on these lines is
// still imported.
const UNTRUSTED_METERS = new Set([
  "2026-08-02|ZA-7291",   // "Meter entry is incomplete, shown only as 15 on the sheet."
  "2026-08-02|KF-3700",   // "Recorded as 32143. The leading digit could also read 82143."
  "2026-08-03|525-03",    // "2nd meter column has partial entry"
]);

// The sheet's category words, in the fleet's own category codes.
const CATEGORY_OF: Record<string, string> = {
  "tipper": "DT", "1 cub": "DT", "1 cub (hire)": "DT", "1 cub (cub)": "DT",
  "jcb": "LB", "excavator": "HEX", "bob cat": "SL", "w/b": "WB",
  "bolero": "DC", "dm cab": "DC", "crew cab": "HCC", "generator": "GE",
  "10 ton": "SR", "4 ton": "SR", "mg": "MG", "compressor": "PE-AC",
  "fiori": "TM", "prime bowser": "BS",
};

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)).toISOString().slice(0, 10);
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

// "N/W" means the meter is broken, "-" that none is fitted, blank that nobody
// wrote anything. None of them is a number and none should become one.
const meterOf = (v: unknown) => {
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function main() {
  console.log(`\n=== Batticaloa Lot-02 August sheets (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);
  const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Fuel Log"], { header: 1, defval: "", blankrows: false })
    .filter((r) => Number(r[0]) > 40000);

  type Fill = { day: string; label: string; category: string; litres: number; meter: number | null; nth: 1 | 2; remark: string };
  const fills: Fill[] = [];
  for (const r of raw) {
    const day = serial(Number(r[0]));
    const label = String(r[2]).trim();
    const category = String(r[3]).trim();
    const remark = String(r[11] || "").trim();
    const untrusted = UNTRUSTED_METERS.has(`${day}|${label}`);
    const first = Number(r[4]), second = Number(r[5]);
    if (Number.isFinite(first) && first > 0) {
      fills.push({ day, label, category, litres: first, meter: untrusted ? null : meterOf(r[7]), nth: 1, remark });
    }
    if (Number.isFinite(second) && second > 0) {
      fills.push({ day, label, category, litres: second, meter: untrusted ? null : meterOf(r[8]), nth: 2, remark });
    }
  }
  fills.sort((a, b) => a.day.localeCompare(b.day));
  const total = fills.reduce((s, f) => s + f.litres, 0);
  console.log(`  sheets: ${raw.length} lines -> ${fills.length} refuels · ${total} L · ${fills[0].day} .. ${fills[fills.length - 1].day}`);

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
  if (!other) throw new Error(`no "Other Asset" category`);

  const created: string[] = [];
  const resolved = new Map<string, { id: string; code: string; meterType: string; projectId: string | null }>();
  for (const label of [...new Set(fills.map((f) => f.label))]) {
    const hit = look(LABEL_MAP[label] ?? label);
    if (hit) { resolved.set(label, hit); continue; }
    const category = fills.find((f) => f.label === label)!.category.toLowerCase();
    const cat = catByCode.get(CATEGORY_OF[category] ?? "") ?? other;
    // A machine with a distance meter is one that drives; the sheet's category
    // says which those are more reliably than any reading would.
    const meterType = ["DT", "DC", "HCC", "SC", "PV", "BD", "LT"].includes(CATEGORY_OF[category] ?? "") ? "KM" : "HOURS";
    created.push(`${label} — "${category || "no category on sheet"}" -> ${cat.name}, ${meterType}`);
    if (!APPLY) { resolved.set(label, { id: `(new:${label})`, code: label, meterType, projectId: project.id }); continue; }
    const made = await prisma.asset.create({ data: {
      code: label, regNo: /^[A-Z]{2,3}-?\d{3,4}$|^\d{2,3}-\d{2,4}$/i.test(label) ? label : null,
      typeLabel: `From the Lot-02 August issuing sheets — "${category}"`,
      status: "ACTIVE", meterType, ownership: "OWNED",
      categoryId: cat.id, projectId: project.id } });
    byCode.set(alnum(made.code), made);
    resolved.set(label, made);
  }

  // ------------------------------------------- what the pump already carries
  const live = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(fills[0].day), lt: new Date(colombo(fills[fills.length - 1].day).getTime() + 86400000) } },
    select: { assetId: true, issueDate: true } });
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }
  const emitted = new Map<string, number>();
  const fresh: Fill[] = [];
  let skipped = 0;
  for (const f of fills) {
    const k = `${f.day}|${resolved.get(f.label)!.id}`;
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    if (done < already) { skipped++; continue; }
    fresh.push(f);
  }
  console.log(`  pump already holds ${live.length} row(s) in that window`);

  // ------------------------------------------------------------ price + insert
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  const priceOn = (day: string) => {
    let p = prices[0];
    for (const x of prices) { if (dayOf(x.effectiveFrom) <= day) p = x; else break; }
    return p;
  };

  // A reading is accepted only if it is at least the highest already accepted for
  // that machine, walking in sheet order. This is what catches 226-3944 on
  // 01/08, whose 2nd meter reads 252075 after a 1st of 252089 — the transcriber
  // flags it as impossible on a forward-running odometer.
  const highest = new Map<string, number>();
  for (const [, a] of resolved) {
    if (a.id.startsWith("(new")) continue;
    const top = await prisma.meterReading.findFirst({ where: { assetId: a.id }, orderBy: { value: "desc" }, select: { value: true } });
    if (top) highest.set(a.id, top.value);
  }
  const dropped: string[] = [];
  let added = 0, litres = 0, cost = 0, meters = 0;

  for (const f of fresh) {
    const asset = resolved.get(f.label)!;
    let keep = f.meter;
    if (keep !== null) {
      const hi = highest.get(asset.id);
      if (hi !== undefined && keep < hi) {
        dropped.push(`${f.day} ${f.label.padEnd(10)} ${f.nth === 1 ? "1st" : "2nd"} meter ${keep} after ${hi}`);
        keep = null;
      } else highest.set(asset.id, keep);
    }
    const when = colombo(f.day);
    const p = priceOn(f.day);
    const c = Math.round(f.litres * p.pricePerLitre);
    added++; litres += f.litres; cost += c;
    if (keep !== null) meters++;
    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({ data: {
        fuelKind: "AUTO_DIESEL", litres: f.litres,
        meterReading: keep, readingType: keep !== null ? asset.meterType : null,
        pricePerLitre: p.pricePerLitre, totalCost: c,
        source: SOURCE, issueDate: when, issuePerson: "Batticaloa ICDP Lot-02",
        assetId: asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id } });
      if (keep !== null) {
        const reading = await tx.meterReading.create({ data: {
          assetId: asset.id, value: keep, readingType: asset.meterType,
          readingDate: when, source: "FUEL_ISSUE", recordedById: admin.id, linkedIssueId: issue.id } });
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { meterReadingRecordId: reading.id } });
      }
    });
  }

  // ------------------------------------------------------------------ report
  console.log(`\n  sheet label -> fleet machine`);
  const byLabel = [...new Set(fills.map((f) => f.label))]
    .sort((a, b) => fills.filter((f) => f.label === b).reduce((s, f) => s + f.litres, 0)
                  - fills.filter((f) => f.label === a).reduce((s, f) => s + f.litres, 0));
  for (const label of byLabel) {
    const mine = fills.filter((f) => f.label === label);
    const a = resolved.get(label)!;
    const isNew = created.some((c) => c.startsWith(label + " "));
    console.log(`      ${label.padEnd(10)} -> ${a.code.padEnd(10)} ${String(mine.length).padStart(2)} fills ${String(mine.reduce((s, f) => s + f.litres, 0)).padStart(4)} L` +
      `${isNew ? "   [NEW machine]" : LABEL_MAP[label] ? `   [written ${label}, same unit as ${LABEL_MAP[label]}]` : ""}`);
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres} L · ${rs(cost)}`);
  if (skipped) console.log(`  already present, left alone: ${skipped}`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters}`);
  console.log(`  meters not stored: ${fills.filter((f) => f.meter === null).length} lines had none on the sheet (N/W, dash or blank)` +
    `${UNTRUSTED_METERS.size ? `, plus ${UNTRUSTED_METERS.size} the transcriber flags as partial or unclear` : ""}`);
  if (dropped.length) {
    console.log(`  readings dropped for going backwards (${dropped.length}) — the fuel is kept:`);
    for (const d of dropped) console.log(`      ${d}`);
  }
  if (created.length) {
    console.log(`\n  machines ${APPLY ? "registered" : "to register"} (${created.length}) — categorised from the sheet's own column:`);
    for (const c of created) console.log(`      ${c}`);
  }
  console.log(`\n  tank stock: ${tank.balance} L, unchanged — the sheets' received/issued/balance boxes are blank,`);
  console.log(`  so there is nothing here to reconcile a closing figure against.`);

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
