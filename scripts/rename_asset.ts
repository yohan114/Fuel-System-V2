import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Correct a machine's fleet code.
//
// Importers name a machine from whatever the sheet said, and a sheet can be
// wrong — the Galagedara workbook read a generator's plate as GE-M47 while
// admitting the photograph was unclear, and the site says it is GE-47. Nothing
// else about the machine changes: its fuel, meter readings, postings, bills and
// service history all hang off its id, not its code, so they follow it.
//
// If the new code already belongs to another machine this refuses. That is not a
// rename but a merge — two records for one machine — and merge_assets.ts is the
// tool that moves the history across and deletes the loser. Silently folding
// them here would hide a duplicate behind what looks like a typo fix.
//
// --reg corrects the PLATE instead of, or as well as, the code. A plate that
// several machines share is worse than a blank one: it is what the fuel books
// are matched on, so a row written against it can land on any of them. Five
// excavators arrived from one import all carrying "14160". Setting a machine's
// plate to its own code is how the rest of the fleet records a machine that has
// no real registration.
//
//   npx tsx scripts/rename_asset.ts --from=GE-M47 --to=GE-47
//   npx tsx scripts/rename_asset.ts --from=GE-M47 --to=GE-47 --apply
//   npx tsx scripts/rename_asset.ts --from=HEX-33 --reg=HEX-33 --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FROM = arg("from");
const TO = arg("to");
const REG = arg("reg");

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function main() {
  if (!FROM || (!TO && !REG)) throw new Error("need --from=CODE with --to=NEW-CODE and/or --reg=PLATE");
  console.log(`\n=== rename a machine (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();

  const asset = await prisma.asset.findFirst({
    where: { code: FROM },
    select: { id: true, code: true, regNo: true, category: { select: { name: true } }, project: { select: { code: true } } } });
  if (!asset) {
    const already = TO ? await prisma.asset.findFirst({ where: { code: TO }, select: { code: true } }) : null;
    throw new Error(already
      ? `no machine is called "${FROM}" — but "${TO}" already exists, so this rename has been done`
      : `no machine is called "${FROM}"`);
  }

  const clash = TO ? await prisma.asset.findFirst({ where: { code: TO }, select: { id: true, code: true, regNo: true } }) : null;
  if (clash) {
    throw new Error(`"${TO}" already belongs to another machine (plate ${clash.regNo ?? "—"}).\n` +
      `  That makes this a merge, not a rename. Use:\n` +
      `    npx tsx scripts/merge_assets.ts --from="${FROM}" --into="${TO}"`);
  }

  const [issues, litres, readings, postings, bills, services] = await Promise.all([
    prisma.fuelIssue.count({ where: { assetId: asset.id } }),
    prisma.fuelIssue.aggregate({ where: { assetId: asset.id, voided: false }, _sum: { litres: true } }),
    prisma.meterReading.count({ where: { assetId: asset.id } }),
    prisma.assetAssignment.count({ where: { assetId: asset.id } }),
    prisma.bill.count({ where: { assetId: asset.id } }),
    prisma.serviceRecord.count({ where: { assetId: asset.id } }),
  ]);

  console.log(`\n  ${asset.code}${TO ? `  ->  ${TO}` : ""}`);
  console.log(`  plate ${asset.regNo ?? "—"}${REG ? `  ->  ${REG}` : ""} · ${asset.category?.name} @ ${asset.project?.code ?? "—"}`);

  // A plate is not unique in the schema, but it is what the fuel books are
  // matched on, so sharing one is a real hazard rather than untidiness.
  if (REG) {
    const sharing = await prisma.asset.findMany({
      where: { regNo: REG, id: { not: asset.id } }, select: { code: true } });
    if (sharing.length) {
      console.log(`  ! "${REG}" is already on ${sharing.map((x) => x.code).join(", ")} — a shared plate`);
      console.log(`    matches whichever machine is found first. Give each its own, or merge them.`);
    }
    if (asset.regNo) {
      const others = await prisma.asset.findMany({
        where: { regNo: asset.regNo, id: { not: asset.id } }, select: { code: true } });
      if (others.length) console.log(`  the old plate "${asset.regNo}" stays on ${others.map((x) => x.code).join(", ")}`);
    }
  }
  console.log(`  ${issues} fuel issues (${Math.round(litres._sum.litres ?? 0).toLocaleString()} L) · ${readings} meter readings · ${postings} postings · ${bills} bills · ${services} services`);
  console.log(`  all of it follows the machine — nothing is deleted or re-dated`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }
  await prisma.asset.update({ where: { id: asset.id },
    data: { ...(TO ? { code: TO } : {}), ...(REG ? { regNo: REG } : {}) } });
  console.log(`\nDone. ${TO ? `"${FROM}" is now "${TO}"` : `"${FROM}" now carries plate "${REG}"`}.\n`);
}

main().finally(() => prisma.$disconnect());
