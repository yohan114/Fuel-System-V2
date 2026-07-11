import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Reconcile CEP-03 E Package's June 2026 fleet to the authoritative site sheet (17
// vehicles) and split MG-07 per the user's correction.
//
//  • MG-07 — was at CEP-03 E through June with a short Galagedara stint (June 20-24,
//    the single 60 L issue on June 24) before that site closed. Rebuild as an E
//    June assignment (whole month) with a June 20-24 CEP-03F carve-out, so the E
//    days bill to E and the Galagedara days + 60 L stay at F. Re-issue keeping the
//    existing invoice number.
//  • ADD to E — DT-67, DT-78 (on the sheet; currently win to Wadakada): drop their
//    CEP-03W June assignment so E (already assigned) becomes the sole segment.
//  • REMOVE from E → Wadakada — 10 vehicles not on the sheet: give each a sole
//    CEP-03W June assignment (preserving driver/billing type) and drop the E one.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z"); // Jun 1 00:00 Colombo
const JE = new Date("2026-06-30T18:29:59.999Z"); // Jun 30 23:59 Colombo
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN20 = new Date("2026-06-19T18:30:00.000Z");
const JUN24_END = new Date("2026-06-24T18:29:59.999Z");
const JUN30_END = new Date("2026-06-30T18:29:59.999Z");

const ADD_TO_E = ["DT-67", "DT-78"];
const REMOVE_TO_W = ["DT-07", "SR-04", "PTR-10", "SC-11", "GE-66", "TM-16", "DT-22", "DT-28", "WG-08", "LG-0019"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function assetByCode(code: string) {
  const a = await prisma.asset.findFirst({ where: { code }, select: { id: true, code: true } });
  if (!a) throw new Error("asset not found: " + code);
  return a;
}
async function juneAssignments(assetId: string) {
  return prisma.assetAssignment.findMany({
    where: { assetId, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] },
    include: { project: true },
  });
}

async function main() {
  const E = await prisma.project.findUnique({ where: { code: "CEP-03E" } });
  const W = await prisma.project.findUnique({ where: { code: "CEP-03W" } });
  const F = await prisma.project.findUnique({ where: { code: "CEP-03F" } });
  if (!E || !W || !F) throw new Error("project missing");
  console.log(`Reconcile CEP-03 E — ${APPLY ? "APPLY" : "dry-run"}\n`);

  const affected: string[] = [];

  // ---- MG-07 split ----
  const mg = await assetByCode("MG-07");
  const mgBill = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: mg.id, year: Y, month: M } } });
  console.log(`MG-07: current bill @${mgBill?.projectCode}/${mgBill?.status} inv=${mgBill?.invoiceNumber} ${rs(mgBill?.grandTotalCents ?? 0)}`);
  const mgAsg = await juneAssignments(mg.id);
  console.log("  June assignments:", mgAsg.map((a) => `${a.project.code}[${a.startDate.toISOString().slice(0, 10)}..${a.endDate?.toISOString().slice(0, 10)}]`).join(" "));
  if (APPLY) {
    // F carve-out → June 20-24
    const fAsg = mgAsg.find((a) => a.project.code === "CEP-03F");
    if (fAsg) await prisma.assetAssignment.update({ where: { id: fAsg.id }, data: { startDate: JUN20, endDate: JUN24_END } });
    // E June assignment (whole month) — create if none overlaps June
    const eJune = mgAsg.find((a) => a.project.code === "CEP-03E");
    if (!eJune) await prisma.assetAssignment.create({ data: { assetId: mg.id, projectId: E.id, startDate: JUN1, endDate: JUN30_END, billingType: fAsg?.billingType ?? null, driverName: fAsg?.driverName ?? null } });
    else await prisma.assetAssignment.update({ where: { id: eJune.id }, data: { startDate: JUN1, endDate: JUN30_END } });
    affected.push(mg.id);
  }

  // ---- ADD DT-67, DT-78 → E (drop W June assignment) ----
  for (const code of ADD_TO_E) {
    const a = await assetByCode(code);
    const asg = await juneAssignments(a.id);
    const hasE = asg.some((x) => x.project.code === "CEP-03E");
    console.log(`ADD ${code}: assignments ${asg.map((x) => x.project.code).join("+")} (hasE=${hasE})`);
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, projectId: W.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      if (!hasE) await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: E.id, startDate: JUN1, endDate: JUN30_END } });
      affected.push(a.id);
    }
  }

  // ---- REMOVE 10 → Wadakada (sole W June assignment) ----
  for (const code of REMOVE_TO_W) {
    const a = await assetByCode(code);
    const asg = await juneAssignments(a.id);
    const dom = [...asg].sort((x, y) => (y.endDate!.getTime() - y.startDate.getTime()) - (x.endDate!.getTime() - x.startDate.getTime()))[0];
    console.log(`REMOVE ${code}: ${asg.map((x) => x.project.code).join("+") || "(none)"} → CEP-03W`);
    if (APPLY) {
      // drop all June-overlapping assignments, create one at W (keep driver/billing type)
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: W.id, startDate: JUN1, endDate: JUN30_END, billingType: dom?.billingType ?? null, driverName: dom?.driverName ?? null } });
      affected.push(a.id);
    }
  }

  if (!APPLY) { console.log("\nDry-run only. Pass --apply."); await prisma.$disconnect(); return; }

  // ---- Regenerate all affected (MG-07 first was ISSUED → unlock) ----
  if (mgBill && mgBill.status !== "DRAFT") {
    await prisma.bill.update({ where: { id: mgBill.id }, data: { status: "DRAFT" } });
  }
  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: affected, regenerate: true, actorId: null });
  console.log(`\nRegenerated: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, skipped ${res.skippedExisting + res.skippedFinalized}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("  ERROR", e.assetCode, e.message);

  // ---- MG-07: re-issue keeping its invoice number ----
  if (mgBill?.invoiceNumber) {
    const nb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: mg.id, year: Y, month: M } }, include: { lineItems: true } });
    await prisma.bill.update({ where: { id: nb!.id }, data: { status: "ISSUED", invoiceNumber: mgBill.invoiceNumber, issuedDate: mgBill.issuedDate ?? new Date() } });
    console.log(`\nMG-07 re-issued as ${mgBill.invoiceNumber}: header @${nb!.projectCode} ${rs(nb!.grandTotalCents)}`);
    for (const li of nb!.lineItems) console.log(`   ${li.kind.padEnd(8)} ${(li.projectName ?? "-").padEnd(22)} ${li.quantity} ${li.unit}  ${rs(li.amountCents)}`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
