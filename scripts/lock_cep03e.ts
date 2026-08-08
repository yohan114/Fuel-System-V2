import { prisma } from "../src/lib/db";
import { getBillingConfig } from "../src/lib/billing/config";
import { nextInvoiceNumber } from "../src/lib/billing/invoice-number";
import { billClarifyReasons } from "../src/lib/billing/clarify";

// Lock CEP-03 E Package — issue every remaining DRAFT June 2026 bill as a final
// invoice (MG-07 already carries EC-INV-2026-0050). Clarification flags are
// force-overridden with an approval note, since the client has reviewed and
// signed off this site. Deterministic order (assetCode) → stable numbering.
//
// Dry-run by default; pass --apply to issue.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const NOTE = "CEP-03 E Package June 2026 — reviewed and approved by client";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const cfg = await getBillingConfig();
  const drafts = await prisma.bill.findMany({
    where: { projectCode: "CEP-03E", year: Y, month: M, status: "DRAFT" },
    orderBy: { assetCode: "asc" },
  });
  const issued = await prisma.bill.findMany({
    where: { projectCode: "CEP-03E", year: Y, month: M, status: { not: "DRAFT" } },
    orderBy: { assetCode: "asc" },
  });
  console.log(`CEP-03 E: ${drafts.length} DRAFT to issue, ${issued.length} already issued (${APPLY ? "APPLY" : "dry-run"})\n`);
  console.log("Already issued:", issued.map((b) => `${b.assetCode}=${b.invoiceNumber}`).join(", ") || "(none)");

  let total = issued.reduce((s, b) => s + b.grandTotalCents, 0);
  for (const d of drafts) {
    const flags = billClarifyReasons(d);
    if (!APPLY) {
      console.log(`  ${d.assetCode.padEnd(9)} ${rs(d.grandTotalCents).padStart(14)}  ${flags.length ? "[override: " + flags.join("; ") + "]" : ""}`);
      total += d.grandTotalCents;
      continue;
    }
    const number = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: d.id } });
      if (!bill || bill.status !== "DRAFT") throw new Error("not draft");
      const num = await nextInvoiceNumber(tx, cfg.invoicePrefix, bill.year);
      const issuedDate = new Date();
      const dueDate = new Date(issuedDate.getTime() + cfg.dueDays * 24 * 60 * 60 * 1000);
      const note = flags.length > 0 ? `${bill.notes ? bill.notes + " · " : ""}Issued with override: ${NOTE}` : bill.notes;
      await tx.bill.update({ where: { id: d.id }, data: { status: "ISSUED", invoiceNumber: num, issuedDate, dueDate, notes: note } });
      await tx.auditLog.create({ data: { actorId: ADMIN, action: "UPDATE", entity: "Bill", entityId: d.id, summary: `Issued invoice ${num} for ${bill.assetCode} (${bill.periodKey})${flags.length ? " — OVERRIDE: " + NOTE : ""}` } });
      return num;
    });
    console.log(`  ${d.assetCode.padEnd(9)} ${number}  ${rs(d.grandTotalCents)}${flags.length ? "  [override]" : ""}`);
    total += d.grandTotalCents;
  }

  console.log(`\nCEP-03 E June total: ${rs(total)} across ${drafts.length + issued.length} invoices.`);
  if (!APPLY) console.log("Dry-run only. Pass --apply to issue.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
