import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

// Import the Galagedara (CEP-03F) diesel stock book — the site's day-by-day
// pump register: every delivery in, every issue out, and the running balance.
//
// This REPLACES the site's existing fuel rather than adding to it, because the
// two describe the same physical fuel. The database currently holds a partial,
// partly-aggregated version from earlier imports whose figures drifted:
// HEX-45 June reads 880 L here against the book's 800 L, HEX-01 580 L against
// 500 L. The already-issued June invoices agree with the BOOK, not the database
// (EC-INV-2026-0048 bills HEX-45 for exactly 800 L), so replacing the rows
// brings the data back in line with what was invoiced. Stacking them would have
// double-counted May and June instead.
//
// Only vehicles the book covers are replaced. It records many of them by number
// plate rather than fleet code — DC-08 appears as "59-5421", HCC-09 as
// "PJ-6376" — so labels resolve through plates as well as codes, and on this
// workbook that accounts for every vehicle the site already had. One machine can
// also appear under two labels (both "ZB-1980" and "LB-21" are LB-21), which is
// why arrival dates key on the resolved vehicle and not on the written label.
//
// Arrival dates: a vehicle's first appearance in the book is the day it reached
// the site, so each one gets a site assignment starting on that date — which is
// what makes it billable from then on and not before.
//
//   npx tsx scripts/import_galagedara_stock_book.ts            # dry run
//   npx tsx scripts/import_galagedara_stock_book.ts --apply

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "/root/.claude/uploads/ddd640e9-2dc1-5d1a-9875-08410003a7a4/cd00a4b9-Diesel_stock_book_1.xlsx";
const SHEET = "Diesel stock book ";
const SOURCE = "Galagedara stock book";
const PROJECT = "CEP-03F";

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
// Excel serial -> yyyy-mm-dd (workbook uses the 1900 system, epoch 1899-12-30)
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
// Colombo midnight, matching how every other importer stores issueDate
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);

// The book is handwritten, so one vehicle appears under several spellings:
// "D 4 D 1", "D 4 D -02", even "D 2 D -02" for the same three machines, and
// "excavetor HEX-45" / "LB-21 Repair" / "PE-3723 ( ... Surveyor Officer )" for
// vehicles whose code is buried in a note.
function normalise(label: string): string {
  const d4d = label.match(/d\s*[42]\s*d\s*-?\s*0?(\d+)/i);
  if (d4d) return `D4D-${String(+d4d[1]).padStart(2, "0")}`;
  const tok = label.match(/[A-Za-z]{1,4}-?\d{2,4}|\d{2,3}-\d{3,4}/);
  return tok ? tok[0].toUpperCase() : label.trim().toUpperCase();
}

type Issue = { date: string; label: string; code: string; litres: number; note: string };
type Receipt = { date: string; desc: string; litres: number; bill: string };

async function main() {
  console.log(`\n=== Galagedara stock book (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const sheet = XLSX.readFile(FILE).Sheets[SHEET];
  if (!sheet) throw new Error(`sheet "${SHEET}" not found in ${FILE}`);
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

  const issues: Issue[] = [];
  const receipts: Receipt[] = [];
  for (const r of raw.slice(5)) {
    const sd = Number(r[0]);
    const label = String(r[1]).trim();
    if (!Number.isFinite(sd) || sd < 40000 || sd > 60000 || !label) continue;
    const date = serial(sd);
    const recv = Number(r[3]) || 0;
    const iss = Number(r[5]) || 0;
    if (/^received/i.test(label)) {
      if (recv > 0) receipts.push({ date, desc: label, litres: recv, bill: String(r[2] || "").trim() });
    } else if (iss > 0) {
      issues.push({ date, label, code: normalise(label), litres: iss, note: String(r[8] || "").trim() });
    }
  }
  console.log(`  parsed: ${issues.length} issues (${issues.reduce((s, i) => s + i.litres, 0)} L) · ` +
    `${receipts.length} receipts (${receipts.reduce((s, r) => s + r.litres, 0)} L)`);

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
  const other = await prisma.category.findFirst({ where: { name: "Other Asset" } });

  const codes = [...new Set(issues.map((i) => i.code))];
  const resolved = new Map<string, { id: string; code: string }>();
  const created: string[] = [];
  for (const c of codes) {
    const hit = byCode.get(alnum(c)) || byReg.get(alnum(c));
    if (hit) { resolved.set(c, hit); continue; }
    // Unknown plate: register it so its fuel is not silently dropped. Parked in
    // the catch-all category — the book records no machine type, and guessing
    // one would attach a wrong PM schedule.
    if (!other) throw new Error(`vehicle ${c} is not in the fleet and no "Other Asset" category exists`);
    created.push(c);
    if (APPLY) {
      const made = await prisma.asset.create({ data: {
        code: c, regNo: c, typeLabel: "From Galagedara stock book",
        status: "ACTIVE", meterType: "KM", ownership: "OWNED",
        categoryId: other.id, projectId: project.id } });
      resolved.set(c, { id: made.id, code: made.code });
    } else resolved.set(c, { id: `(new:${c})`, code: c });
  }

  // ------------------------------------------- replace this site's book fuel
  const bookAssetIds = [...resolved.values()].map((a) => a.id).filter((id) => !id.startsWith("(new"));
  const superseded = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, assetId: { in: bookAssetIds } },
    select: { id: true, litres: true, source: true, asset: { select: { code: true } } },
  });
  const keep = await prisma.fuelIssue.count({ where: { bulkTankId: tank.id, assetId: { notIn: bookAssetIds } } });
  console.log(`\n  superseded rows to remove: ${superseded.length} (${superseded.reduce((s, x) => s + x.litres, 0).toFixed(0)} L)`);
  const bySrc = new Map<string, number>();
  for (const s of superseded) bySrc.set(s.source, (bySrc.get(s.source) || 0) + 1);
  for (const [s, n] of bySrc) console.log(`      ${n} from "${s}"`);
  console.log(`  rows kept (vehicles the book does not cover): ${keep}`);
  if (APPLY && superseded.length) {
    await prisma.fuelIssue.deleteMany({ where: { id: { in: superseded.map((s) => s.id) } } });
  }

  // ------------------------------------------------------------ insert issues
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true } });
  const priceAt = (d: Date) => { let p = prices[0]; for (const x of prices) { if (x.effectiveFrom <= d) p = x; else break; } return p; };

  let added = 0, litres = 0, cost = 0;
  for (const i of issues) {
    const asset = resolved.get(i.code)!;
    const when = colombo(i.date);
    const p = priceAt(when);
    litres += i.litres; cost += Math.round(i.litres * p.pricePerLitre); added++;
    if (APPLY) await prisma.fuelIssue.create({ data: {
      fuelKind: "AUTO_DIESEL", litres: i.litres,
      pricePerLitre: p.pricePerLitre, totalCost: Math.round(i.litres * p.pricePerLitre),
      source: SOURCE, issueDate: when, issuePerson: "Galagedara",
      assetId: asset.id, issuedById: admin.id, fuelPriceId: p.id, bulkTankId: tank.id,
    }});
  }

  // ------------------------------------------------- arrival-date assignments
  // First fuel drawn at the site is the day the vehicle got there; billing
  // starts from that date and not before.
  // Keyed by the resolved vehicle, not the written label: LB-21 is written both
  // as "ZB-1980" (from 11 May) and as "LB-21" (from 1 July), and its arrival is
  // the earlier of the two.
  const firstSeen = new Map<string, { code: string; date: string }>();
  for (const i of issues) {
    const asset = resolved.get(i.code)!;
    const cur = firstSeen.get(asset.id);
    if (!cur || i.date < cur.date) firstSeen.set(asset.id, { code: asset.code, date: i.date });
  }
  let asgNew = 0, asgKept = 0, asgMoved = 0;
  const arrivals: string[] = [];
  for (const [assetId, { code, date }] of [...firstSeen].sort((a, b) => a[1].date.localeCompare(b[1].date))) {
    const asset = { id: assetId, code };
    const start = colombo(date);
    if (asset.id.startsWith("(new")) { asgNew++; arrivals.push(`${code} → ${date}`); continue; }
    const existing = await prisma.assetAssignment.findFirst({
      where: { assetId: asset.id, projectId: project.id }, orderBy: { startDate: "asc" } });
    if (!existing) {
      asgNew++; arrivals.push(`${code} → ${date}`);
      if (APPLY) await prisma.assetAssignment.create({ data: {
        assetId: asset.id, projectId: project.id, startDate: start, endDate: null,
        note: `Arrived at site — first fuel drawn ${date} (stock book)`, createdById: admin.id } });
    } else if (existing.startDate.getTime() > start.getTime()) {
      // an assignment exists but starts later than the vehicle was actually here
      asgMoved++; arrivals.push(`${code} → ${date} (was ${existing.startDate.toISOString().slice(0, 10)})`);
      if (APPLY) await prisma.assetAssignment.update({ where: { id: existing.id }, data: { startDate: start } });
    } else asgKept++;
  }

  // ------------------------------------------------------ receipts + balance
  let recNew = 0;
  for (const r of receipts) {
    const when = colombo(r.date);
    const dup = await prisma.bulkRequest.findFirst({
      where: { bulkTankId: tank.id, requestedLitres: r.litres, createdAt: when }, select: { id: true } });
    if (dup) continue;
    recNew++;
    if (APPLY) await prisma.bulkRequest.create({ data: {
      fuelKind: "AUTO_DIESEL", requestedLitres: r.litres, status: "APPROVED",
      createdAt: when, reviewedAt: when, sourceType: "OUTSIDE", bulkTankId: tank.id,
      requestedById: admin.id, reviewedById: admin.id,
      reviewNote: r.bill ? `${r.desc} · bill ${r.bill}` : r.desc } });
  }
  const closing = receipts.reduce((s, r) => s + r.litres, 0) - issues.reduce((s, i) => s + i.litres, 0);
  if (APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: closing } });

  // ------------------------------------------------------------------ report
  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${litres.toFixed(0)} L · ${rs(cost)}`);
  console.log(`  deliveries  ${APPLY ? "added" : "to add"}: ${recNew} · ${receipts.reduce((s, r) => s + r.litres, 0)} L`);
  console.log(`  tank balance ${APPLY ? "set to" : "would be"}: ${closing} L  (received − issued)`);
  if (created.length) console.log(`\n  vehicles ${APPLY ? "registered" : "to register"} (not in the fleet, filed under Other Asset — reclassify when known):\n      ${created.join(", ")}`);
  console.log(`\n  site arrivals ${APPLY ? "recorded" : "to record"}: ${asgNew} new, ${asgMoved} pulled earlier, ${asgKept} already correct`);
  for (const a of arrivals.slice(0, 12)) console.log(`      ${a}`);
  if (arrivals.length > 12) console.log(`      … and ${arrivals.length - 12} more`);

  const monthly = new Map<string, number>();
  for (const i of issues) monthly.set(i.date.slice(0, 7), (monthly.get(i.date.slice(0, 7)) || 0) + i.litres);
  console.log(`\n  monthly issued litres:`);
  for (const [m, l] of [...monthly].sort()) console.log(`      ${m}  ${l.toFixed(0)} L`);

  if (!APPLY) console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`);
  else console.log(`\nDone. Issued June invoices were not touched.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
