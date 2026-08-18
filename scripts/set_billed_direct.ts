import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Mark machines the client settles direct with their owner.
//
// E&C invoices neither their rental nor their fuel, though they are posted to
// sites and draw from site pumps like anything else — so they keep appearing in
// the fleet, the fuel report and the postings, and only the bill leaves them
// out. The summary names them, so the omission reads as a decision rather than
// a machine someone forgot.
//
// This is a property of the MACHINE, not of one month. Filtering a single bill
// run instead would put them back on next month's invoice with nobody noticing,
// which is the failure this flag exists to prevent.
//
//   npx tsx scripts/set_billed_direct.ts --codes=D4D-01,D4D-02
//   npx tsx scripts/set_billed_direct.ts --codes=D4D-01,D4D-02 --apply
//   npx tsx scripts/set_billed_direct.ts --codes=D4D-01 --off --apply
//   npx tsx scripts/set_billed_direct.ts --list

const APPLY = process.argv.includes("--apply");
const OFF = process.argv.includes("--off");
const LIST = process.argv.includes("--list");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  console.log(`\n=== billed direct ${LIST ? "(list)" : APPLY ? "(APPLY)" : "(DRY-RUN)"} ===`);
  console.log(`  database: ${path.resolve(process.cwd(), url.replace(/^file:/, ""))}\n`);

  if (LIST) {
    const on = await prisma.asset.findMany({ where: { billedDirect: true },
      select: { code: true, regNo: true, typeLabel: true }, orderBy: { code: "asc" } });
    console.log(`  ${on.length} machine(s) settled direct — E&C bills nothing for these:`);
    for (const a of on) console.log(`      ${a.code.padEnd(12)}${(a.regNo ?? "—").padEnd(12)}${a.typeLabel ?? "—"}`);
    console.log("");
    return;
  }

  const codes = (arg("codes") || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error("need --codes=CODE,CODE (or --list)");

  const assets = await prisma.asset.findMany({ where: { code: { in: codes } },
    select: { id: true, code: true, regNo: true, billedDirect: true, rentalRate: { select: { assetId: true } } } });
  const missing = codes.filter((c) => !assets.some((a) => a.code === c));
  if (missing.length) throw new Error(`not in the fleet: ${missing.join(", ")} — nothing written`);

  // Bills already issued are not rewritten by a flag. Say so rather than let
  // someone assume an invoice already with a client has quietly changed.
  const billed = await prisma.bill.findMany({
    where: { assetId: { in: assets.map((a) => a.id) }, status: { not: "DRAFT" } },
    select: { assetCode: true, periodKey: true, status: true, invoiceNumber: true } });

  for (const a of assets) {
    const now = a.billedDirect;
    const next = !OFF;
    console.log(`  ${a.code.padEnd(12)}${(a.regNo ?? "—").padEnd(12)}${now === next ? "already " : ""}${next ? "billed direct" : "billable by E&C"}` +
      `${!next && !a.rentalRate ? "   (no rate card — will bill no rental until one is set)" : ""}`);
    if (APPLY && now !== next) await prisma.asset.update({ where: { id: a.id }, data: { billedDirect: next } });
  }

  if (billed.length) {
    console.log(`\n  ! these already have an ISSUED bill, which this does not touch:`);
    for (const b of billed) console.log(`      ${b.assetCode.padEnd(12)}${b.periodKey}  ${b.status}  ${b.invoiceNumber ?? ""}`);
    console.log(`      Credit them if they should not have been charged.`);
  }

  console.log(APPLY ? `\nDone. Re-run the affected months' bills.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
