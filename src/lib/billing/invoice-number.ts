import type { Prisma } from "@prisma/client";

// Per-year invoice numbering.
//
// Invoices now carry a gapless sequence that runs continuously through a
// calendar year and resets each January: EC-INV-2026-0001, EC-INV-2026-0002, …
// The previous scheme reset the sequence every month, minting a fresh "0001"
// twelve times a year, which made the invoice register impossible to reconcile
// and is not acceptable on a VAT tax invoice. The sequence is allocated from an
// InvoiceCounter row *inside* the issuing transaction so two concurrent
// finalizes can never mint the same number.

// Pure formatter — the single source of an invoice number's shape.
export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

// Allocate the next sequence for a year, atomically, within an issuing
// transaction. The counter is lazily seeded from however many invoices were
// already issued in that year (including any under the legacy per-month scheme)
// so the continuous sequence never overlaps historical numbers.
export async function allocateInvoiceSeq(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<number> {
  const existing = await tx.invoiceCounter.findUnique({ where: { year } });
  if (!existing) {
    const priorIssued = await tx.bill.count({
      where: { year, invoiceNumber: { not: null } },
    });
    // upsert (not create) so a racing transaction that seeded first doesn't
    // trip the unique constraint; an existing row is left untouched.
    await tx.invoiceCounter.upsert({
      where: { year },
      create: { year, lastSeq: priorIssued },
      update: {},
    });
  }
  const updated = await tx.invoiceCounter.update({
    where: { year },
    data: { lastSeq: { increment: 1 } },
  });
  return updated.lastSeq;
}

// Convenience: allocate + format in one call.
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  prefix: string,
  year: number,
): Promise<string> {
  const seq = await allocateInvoiceSeq(tx, year);
  return formatInvoiceNumber(prefix, year, seq);
}
