// Pure payment-ledger math. An invoice can take several part-payments; the sum
// is the amount received, and the invoice is fully paid once that covers the
// grand total. Used by the payment actions, the aging report and the UI so the
// running balance is computed one way everywhere.

export interface PaymentAmount {
  amountCents: number;
}

export interface PaymentSummary {
  paidCents: number;
  outstandingCents: number; // grandTotal − paid; negative if overpaid
  fullyPaid: boolean;
}

export function summarizePayments(grandTotalCents: number, payments: PaymentAmount[]): PaymentSummary {
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  return {
    paidCents,
    outstandingCents: grandTotalCents - paidCents,
    fullyPaid: grandTotalCents > 0 && paidCents >= grandTotalCents,
  };
}
