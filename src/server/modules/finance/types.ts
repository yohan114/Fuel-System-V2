// ============================================================================
// Phase 19 / Wave F: Finance & Receivables Expansion Contracts
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Defines Customer Credit Controls, Multi-Invoice Lump-Sum Payment Allocations,
// Accounts Receivable (AR) Invoices, and Financial Aging Schedule reports.
// ============================================================================

export type PaymentMethod = "CHEQUE" | "BANK_TRANSFER" | "CASH" | "CREDIT_NOTE";

export type InvoiceARStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export interface CustomerAccount {
  id: string;
  customerName: string;
  creditLimitCents: number;
  outstandingBalanceCents: number;
  unallocatedCreditCents: number;
  creditHold: boolean;
  creditHoldReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ARInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  totalAmountCents: number;
  paidAmountCents: number;
  balanceDueCents: number;
  status: InvoiceARStatus;
  issueDate: Date;
  dueDate: Date;
}

export interface InvoicePaymentAllocation {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  previousBalanceCents: number;
  newBalanceCents: number;
}

export interface PaymentRecord {
  id: string;
  paymentNumber: string;
  customerId: string;
  totalAmountCents: number;
  unallocatedAmountCents: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  receivedAt: Date;
  receivedBy: string;
  allocations: InvoicePaymentAllocation[];
  notes?: string;
}

export interface CustomerAgingReport {
  customerId: string;
  customerName: string;
  current0to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  over90DaysCents: number;
  totalOutstandingCents: number;
  oldestInvoiceDueDate?: Date;
}

export interface CreditCheckResult {
  approved: boolean;
  customerId: string;
  creditHold: boolean;
  creditLimitCents: number;
  currentBalanceCents: number;
  availableCreditCents: number;
  requestedAmountCents: number;
  reason?: string;
}

export interface CreateCustomerAccountDto {
  id: string;
  customerName: string;
  creditLimitCents: number;
}

export interface PostARInvoiceDto {
  id?: string;
  invoiceNumber: string;
  customerId: string;
  totalAmountCents: number;
  issueDate?: Date;
  dueDate: Date;
}

export interface AllocatePaymentDto {
  customerId: string;
  paymentAmountCents: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  targetInvoiceIds?: string[];
  notes?: string;
}

export interface SetCreditHoldDto {
  customerId: string;
  creditHold: boolean;
  reason?: string;
}
