import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the Galagedara (CEP-03F) fuel + allocation workbook.
//
// Supersedes import_galagedara_stock_book.ts. This workbook is the same site
// register carried further and corrected: it runs to 5 August rather than
// 1 August, and folds in two sources the raw stock book never had ("Issue log"
// and "Aug photo sheets"). May and June agree to the litre; July differs by 61 L
// and August by more than two thousand.
//
// So it REPLACES the site's fuel rather than adding to it. The two describe the
// same refuels, and stacking them would roughly double the site — the same trap
// the stock book itself presented against the register before it.
//
// Vehicle labels need both columns. The workbook's tidied column has
// OCR-style damage from the handwritten sheet (ZB-1980 became "2B-1980",
// ZB-4606 became "2B-4606"), while the as-written column keeps the original
// spelling but not a consistent format. Trying both, plus the usual
// digit-for-letter confusions, resolves 435 of 436 rows.
//
//   npx tsx scripts/import_galagedara_monthly.ts            # dry run
//   npx tsx scripts/import_galagedara_monthly.ts --apply

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/source-sheets/Galagedara_Fuel_Monthly_and_Vehicle_Allocation.xlsx";
const PROJECT = "CEP-03F";

const alnum = (s: string) => String(s).replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);

// "D 4 D -02", "excavetor HEX-45", "LB-21 Repair" -> the code buried inside.
function tidy(label: string): string {
  const d4d = String(label).match(/d\s*[42]\s*d\s*-?\s*0?(\d+)/i);
  if (d4d) return `D4D-${String(+d4d[1]).padStart(2, "0")}`;
  const tok = String(label).match(/[A-Za-z]{1,4}-?\d{2,4}|\d{2,3}-\d{3,4}/);
  return tok ? tok[0].toUpperCase() : String(label).trim().toUpperCase();
}

// A digit read for a letter is the usual failure on a handwritten register.
const variants = (s: string) => [
  s, s.replace(/^2B/i, "ZB"), s.replace(/^2/, "Z"),
  s.replace(/O/g, "0"), s.replace(/I/g, "1"), s.replace(/-II$/, "-02"),
];

async function main() {
  console.log(`\n=== Galagedara fuel + allocation workbook (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  const wb = XLSX.readFile(FILE);
  const sheet = (n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) as any[][];

  const issueRows = sheet("Fuel Issues").slice(4).filter((r) => Number(r[0]) > 40000 && Number(r[4]) > 0);
  const receiptRows = sheet("Receipts").slice(4).filter((r) => Number(r[0]) > 40000 && Number(r[3]) > 0);
  const allocRows = sheet("Allocation Register").slice(4).filter((r) => String(r[1]).trim() && Number(r[2]) > 40000);

  const issuedTotal = issueRows.reduce((s, r) => s + Number(r[4]), 0);
  const receivedTotal = receiptRows.reduce((s, r) => s + Number(r[3]), 0);
  console.log(`  parsed: ${issueRows.length} issues (${issuedTotal} L) · ${receiptRows.length} receipts (${receivedTotal} L) · ${allocRows.length} allocations`);

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
  // One label pair resolves once. The allocation sheet names the same machines as
  // the issue sheet, and resolving each independently registered GE-M47 twice —
  // as GE-47 from one column and M47 from the other.
  const resolvedCache = new Map<string, { id: string; code: string; regNo?: string | null }>();
  const resolveVehicle = async (tidied: string, written: string) => {
    const ck = `${tidied}||${written}`;
    const cached = resolvedCache.get(ck);
    if (cached) return cached;
    const out = await resolveUncached(tidied, written);
    resolvedCache.set(ck, out);
    // also cache under each single label, so the allocation sheet's one-column
    // lookup finds what the issue sheet already resolved
    resolvedCache.set(`${tidied}||${tidied}`, out);
    resolvedCache.set(`${written}||${written}`, out);
    return out;
  };
  const resolveUncached = async (tidied: string, written: string) => {
    for (const c of [tidied, written, tidy(tidied), tidy(written),
                     ...variants(tidied), ...variants(written),
                     ...variants(tidy(tidied)), ...variants(tidy(written))]) {
      const hit = look(c); if (hit) return hit;
    }
    // Unknown: register it rather than drop its fuel. A code whose prefix is a
    // real category (GE- is a generator) gets that category; anything else goes
    // to the catch-all, because a wrong category attaches a wrong PM schedule.
    const code = tidy(written) || tidy(tidied);
    const prefix = code.split(/[-\s]/)[0].toUpperCase();
    const cat = catByCode.get(prefix) || other;
    if (!cat) throw new Error(`no category available for ${code}`);
    created.push(`${code} (${cat.name})`);
    if (!APPLY) return { id: `(new:${code})`, code, regNo: null };
    const made = await prisma.asset.create({ data: {
      code, regNo: null, typeLabel: "From Galagedara workbook",
      status: "ACTIVE", meterType: "HOURS", ownership: "OWNED",
      categoryId: cat.id, projectId: project.id } });
    byCode.set(alnum(made.code), made);
    return made;
  };

  type Row = { date: string; asset: { id: string; code: string }; litres: number; src: string };
  const parsed: Row[] = [];
  for (const r of issueRows) {
    const asset = await resolveVehicle(String(r[2]).trim(), String(r[3]).trim());
    parsed.push({
      date: serial(Number(r[0])),
      asset,
      litres: Number(r[4]),
      src: String(r[5] || "").trim() || "Stock book",
    });
  }

  // ------------------------------------------------ replace this site's fuel
  const ids = [...new Set(parsed.map((p) => p.asset.id))].filter((i) => !i.startsWith("(new"));
  const superseded = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, assetId: { in: ids } },
    select: { id: true, litres: true, source: true } });
  const keep = await prisma.fuelIssue.count({ where: { bulkTankId: tank.id, assetId: { notIn: ids } } });
  console.log(`\n  superseded rows to remove: ${superseded.length} (${superseded.reduce((s, x) => s + x.litres, 0).toFixed(0)} L)`);
  const bySrc = new Map<string, number>();
  for (const s of superseded) bySrc.set(s.source, (bySrc.get(s.source) || 0) + 1);
  for (const [s, n] of bySrc) console.log(`      ${n} from "${s}"`);
  console.log(`  rows kept (vehicles the workbook does not cover): ${keep}`);
  if (APPLY && superseded.length) {
    await prisma.fuelIssue.deleteMany({ where: { id: { in: superseded.map((s) => s.id) } } });
  }

  // ------------------------------------------------------------ insert issues
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  const priceAt = (d: Date) => { let p = prices[0]; for (const x of prices) { if (x.effectiveFrom <= d) p = x; else break; } return p; };

  let added = 0, litres = 0, cost = 0;
  for (const row of parsed) {
    const when = colombo(row.date);
    const p = priceAt(when);
    const c = Math.round(row.litres * p.pricePerLitre);
    added++; litres += row.litres; cost += c;
    if (APPLY) await prisma.fuelIssue.create({ data: {
      fuelKind: "AUTO_DIESEL", litres: row.litres,
      pricePerLitre: p.pricePerLitre, totalCost: c,
      source: `Galagedara ${row.src.toLowerCase()}`,
      issueDate: when, issuePerson: "Galagedara",
      assetId: row.asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id,
    }});
  }

  // ------------------------------------------------------ receipts + balance
  let recNew = 0;
  const liveReceipts = new Set((await prisma.bulkRequest.findMany({
    where: { bulkTankId: tank.id }, select: { requestedLitres: true, createdAt: true } }))
    .map((r) => `${r.requestedLitres}|${r.createdAt.toISOString()}`));
  for (const r of receiptRows) {
    const when = colombo(serial(Number(r[0])));
    const l = Number(r[3]);
    if (liveReceipts.has(`${l}|${when.toISOString()}`)) continue;
    liveReceipts.add(`${l}|${when.toISOString()}`);
    recNew++;
    if (APPLY) await prisma.bulkRequest.create({ data: {
      fuelKind: "AUTO_DIESEL", requestedLitres: l, status: "APPROVED",
      createdAt: when, reviewedAt: when, sourceType: "OUTSIDE", bulkTankId: tank.id,
      requestedById: admin.id, reviewedById: admin.id,
      reviewNote: String(r[2] || "Received").trim() } });
  }

  // ------------------------------------------------- allocation (arrival) dates
  let asgNew = 0, asgMoved = 0, asgKept = 0;
  const arrivals: string[] = [];
  for (const r of allocRows) {
    const asset = await resolveVehicle(String(r[1]).trim(), String(r[1]).trim());
    if (asset.id.startsWith("(new")) continue;   // counted where it was registered
    const start = colombo(serial(Number(r[2])));
    const existing = await prisma.assetAssignment.findFirst({
      where: { assetId: asset.id, projectId: project.id }, orderBy: { startDate: "asc" } });
    if (!existing) {
      asgNew++; arrivals.push(`${asset.code} → ${serial(Number(r[2]))}`);
      if (APPLY) await prisma.assetAssignment.create({ data: {
        assetId: asset.id, projectId: project.id, startDate: start, endDate: null,
        note: `Allocated to site — first fuel ${serial(Number(r[2]))} (workbook)`, createdById: admin.id } });
    } else if (existing.startDate.getTime() > start.getTime()) {
      asgMoved++; arrivals.push(`${asset.code} → ${serial(Number(r[2]))} (was ${existing.startDate.toISOString().slice(0, 10)})`);
      if (APPLY) await prisma.assetAssignment.update({ where: { id: existing.id }, data: { startDate: start } });
    } else asgKept++;
  }

  // The workbook's own arithmetic goes negative: August deliveries have not been
  // written up yet, so stock cannot be derived from it. Report the gap instead of
  // storing a balance the tank cannot physically hold.
  const closing = receivedTotal - issuedTotal;

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres.toFixed(0)} L · ${rs(cost)}`);
  const months = new Map<string, number>();
  for (const p of parsed) months.set(p.date.slice(0, 7), (months.get(p.date.slice(0, 7)) || 0) + p.litres);
  for (const [m, l] of [...months].sort()) console.log(`      ${m}  ${l.toFixed(0)} L`);
  console.log(`  deliveries ${APPLY ? "added" : "to add"}: ${recNew} (workbook holds ${receiptRows.length}, ${receivedTotal} L)`);
  if (created.length) console.log(`\n  vehicles ${APPLY ? "registered" : "to register"}: ${created.join(", ")}`);
  console.log(`\n  site arrivals: ${asgNew} new, ${asgMoved} pulled earlier, ${asgKept} already correct`);
  for (const a of arrivals.slice(0, 10)) console.log(`      ${a}`);
  if (arrivals.length > 10) console.log(`      … and ${arrivals.length - 10} more`);

  console.log(`\n  received ${receivedTotal} L − issued ${issuedTotal} L = ${closing} L`);
  if (closing < 0) {
    console.log(`  TANK STOCK NOT SET — that figure is negative, so the workbook is missing`);
    console.log(`  deliveries (it records none at all for August against ${(months.get("2026-08") || 0).toFixed(0)} L issued).`);
    console.log(`  Add the August receipts and the balance can be derived; until then the`);
    console.log(`  tank keeps its current ${tank.balance} L rather than an impossible one.`);
  } else if (APPLY) {
    await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: closing } });
    console.log(`  tank stock set to ${closing} L`);
  }

  if (!APPLY) console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`);
  else console.log(`\nDone.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
