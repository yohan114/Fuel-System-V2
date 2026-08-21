/**
 * Render what the two "final bill" documents will actually produce, using the
 * same code paths the routes use — the consolidated loader and both PDF
 * documents. Catches anything the arithmetic tests cannot: a bad style, a
 * missing field, a document that throws while laying out the new Site Split.
 *
 *   npx tsx scripts/verify-split-render.tsx 2026 7
 */
import React from "react";
import fs from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "../src/lib/db";
import { loadConsolidatedBilling } from "../src/lib/billing/consolidated-data";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { InvoiceDocument } from "../src/lib/billing/invoice-document";

const year = parseInt(process.argv[2] || "2026", 10);
const month = parseInt(process.argv[3] || "7", 10);
const OUT = "backups/split-verify";

const rs = (c: number) => (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;

  // ── the consolidated document, as the route builds it ──────────────────────
  const { bills, statements, stmtTotals, sourceBillCount, splitBillCount } =
    await loadConsolidatedBilling(year, month, null);
  bills.sort((a, b) => (a.projectName || "").localeCompare(b.projectName || "") || b.grandTotalCents - a.grandTotalCents);

  console.log(`\n════ CONSOLIDATED — ${periodKey} ════`);
  console.log(`  vehicles billed            ${sourceBillCount}`);
  console.log(`  split across sites         ${splitBillCount}`);
  console.log(`  site-wise rows             ${bills.length}`);
  console.log(`  sites on the statement     ${statements.length}`);
  console.log(`  invoiced (statement)       ${rs(stmtTotals.invoicedCents)}`);
  const grand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  console.log(`  grand total (all rows)     ${rs(grand)}`);

  const consolidated = await renderToBuffer(
    <ConsolidatedDocument
      bills={bills}
      periodKey={periodKey}
      generatedAt="21 Aug 2026"
      statements={statements}
      stmtTotals={stmtTotals}
    />
  );
  fs.writeFileSync(`${OUT}/consolidated_${periodKey}.pdf`, consolidated);
  console.log(`  ✓ consolidated PDF rendered  ${(consolidated.length / 1024).toFixed(0)} KB`);

  // ── one site's own copy, to prove the filter reaches split portions ────────
  const gala = await loadConsolidatedBilling(year, month, "CEP-03F");
  const galaHex = gala.bills.find((b) => b.assetCode === "HEX-37");
  console.log(`\n  Galagedara (CEP-03F) alone: ${gala.bills.length} rows, ${rs(gala.bills.reduce((s, b) => s + b.grandTotalCents, 0))}`);
  console.log(`  HEX-37 present in it?       ${galaHex ? `yes — ${rs(galaHex.grandTotalCents)} for ${galaHex.assignedDays} days` : "NO — the filter dropped it"}`);
  if (!galaHex) process.exitCode = 1;

  // ── the single-vehicle invoice for the machine that worked three sites ─────
  const bill = await prisma.bill.findFirst({
    where: { year, month, assetCode: "HEX-37" },
    include: { lineItems: true },
  });
  if (!bill) {
    console.log(`\n  (no HEX-37 bill in ${periodKey} — skipping the invoice render)`);
  } else {
    const invoice = await renderToBuffer(<InvoiceDocument bill={bill} />);
    fs.writeFileSync(`${OUT}/invoice_HEX-37_${periodKey}.pdf`, invoice);
    console.log(`\n════ INVOICE — HEX-37 ${periodKey} ════`);
    console.log(`  grand total                ${rs(bill.grandTotalCents)}`);
    console.log(`  ✓ invoice PDF rendered     ${(invoice.length / 1024).toFixed(0)} KB  (with Site Split section)`);
  }

  console.log(`\n  written to ${OUT}/`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
