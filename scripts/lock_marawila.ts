import { prisma } from "../src/lib/db";
import { getBillingConfig } from "../src/lib/billing/config";
import { nextInvoiceNumber } from "../src/lib/billing/invoice-number";
import { billClarifyReasons } from "../src/lib/billing/clarify";

// Lock Marawila (MARA) — issue every DRAFT June 2026 bill as a final invoice.
const APPLY = process.argv.includes("--apply");
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const NOTE = "Marawila dry rental — reviewed and approved by client";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const cfg = await getBillingConfig();
  const drafts = await prisma.bill.findMany({ where: { projectCode: "MARA", year: 2026, month: 6, status: "DRAFT" }, orderBy: { grandTotalCents: "desc" } });
  console.log(`Marawila June: ${drafts.length} DRAFT to issue (${APPLY ? "APPLY" : "dry-run"})\n`);
  let total = 0;
  for (const d of drafts) {
    const flags = billClarifyReasons(d);
    if (!APPLY) { console.log(`  ${d.assetCode.padEnd(9)} ${rs(d.grandTotalCents)}${flags.length ? "  [override]" : ""}`); total += d.grandTotalCents; continue; }
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
  console.log(`\nMarawila June total: ${rs(total)} across ${drafts.length} invoices.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
