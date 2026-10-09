// ============================================================================
// Phase 19 / Wave F: Finance & Receivables Domain Application Service
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Encapsulates Customer Credit Limit validation, Multi-Invoice Lump-Sum Payment
// Allocation (FIFO), Accounts Receivable tracking, and Aging Schedule calculations.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import crypto from "crypto";
import type {
  CustomerAccount,
  ARInvoice,
  PaymentRecord,
  InvoicePaymentAllocation,
  CustomerAgingReport,
  CreditCheckResult,
  CreateCustomerAccountDto,
  PostARInvoiceDto,
  AllocatePaymentDto,
  SetCreditHoldDto,
} from "./types";
import { getKafkaBroker } from "@/lib/events/kafka-producer";

@Injectable()
export class FinanceService {
  private customers = new Map<string, CustomerAccount>();
  private invoices = new Map<string, ARInvoice>();
  private payments = new Map<string, PaymentRecord>();
  private paymentCounter = 1000;

  /**
   * Registers a customer account with a defined credit limit.
   */
  async createCustomerAccount(dto: CreateCustomerAccountDto): Promise<CustomerAccount> {
    if (dto.creditLimitCents < 0) {
      throw new BadRequestException("Credit limit cannot be negative");
    }

    const account: CustomerAccount = {
      id: dto.id,
      customerName: dto.customerName,
      creditLimitCents: dto.creditLimitCents,
      outstandingBalanceCents: 0,
      unallocatedCreditCents: 0,
      creditHold: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.customers.set(dto.id, account);
    return account;
  }

  /**
   * Verifies credit approval before fuel dispatch or vehicle rental allocation.
   */
  async checkCreditApproval(
    customerId: string,
    requestedAmountCents: number
  ): Promise<CreditCheckResult> {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new NotFoundException(`Customer account '${customerId}' not found`);
    }

    const netOutstanding = customer.outstandingBalanceCents - customer.unallocatedCreditCents;
    const availableCredit = Math.max(0, customer.creditLimitCents - netOutstanding);

    if (customer.creditHold) {
      return {
        approved: false,
        customerId,
        creditHold: true,
        creditLimitCents: customer.creditLimitCents,
        currentBalanceCents: netOutstanding,
        availableCreditCents: availableCredit,
        requestedAmountCents,
        reason: `Customer is on credit hold: ${customer.creditHoldReason || "Administrative hold"}`,
      };
    }

    if (requestedAmountCents > availableCredit) {
      return {
        approved: false,
        customerId,
        creditHold: false,
        creditLimitCents: customer.creditLimitCents,
        currentBalanceCents: netOutstanding,
        availableCreditCents: availableCredit,
        requestedAmountCents,
        reason: `Requested amount (${(requestedAmountCents / 100).toFixed(2)} LKR) exceeds available credit limit (${(availableCredit / 100).toFixed(2)} LKR)`,
      };
    }

    return {
      approved: true,
      customerId,
      creditHold: false,
      creditLimitCents: customer.creditLimitCents,
      currentBalanceCents: netOutstanding,
      availableCreditCents: availableCredit,
      requestedAmountCents,
    };
  }

  /**
   * Sets or lifts a customer credit hold. Requires ADMIN or MANAGER role.
   */
  async setCreditHold(
    dto: SetCreditHoldDto,
    actorId: string,
    actorRole: string
  ): Promise<CustomerAccount> {
    const customer = this.customers.get(dto.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer account '${dto.customerId}' not found`);
    }

    const authorizedRoles = ["ADMIN", "MANAGER", "SUPER_ADMIN"];
    if (!authorizedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `User with role '${actorRole}' is not authorized to modify customer credit holds`
      );
    }

    customer.creditHold = dto.creditHold;
    customer.creditHoldReason = dto.creditHold ? dto.reason || "Credit hold applied" : undefined;
    customer.updatedAt = new Date();

    // Emit CreditHoldApplied to Kafka broker
    const broker = getKafkaBroker();
    await broker.publish("billing.invoice.generated", [
      {
        key: customer.id,
        value: JSON.stringify({
          eventType: "CreditHoldStatusChanged",
          customerId: customer.id,
          creditHold: customer.creditHold,
          reason: customer.creditHoldReason,
          updatedBy: actorId,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return customer;
  }

  /**
   * Posts an Accounts Receivable invoice to the customer ledger.
   */
  async postARInvoice(dto: PostARInvoiceDto): Promise<ARInvoice> {
    const customer = this.customers.get(dto.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer account '${dto.customerId}' not found`);
    }

    if (dto.totalAmountCents <= 0) {
      throw new BadRequestException("Invoice amount must be positive");
    }

    const id = dto.id || `ar_inv_${crypto.randomUUID()}`;
    const invoice: ARInvoice = {
      id,
      invoiceNumber: dto.invoiceNumber,
      customerId: dto.customerId,
      totalAmountCents: dto.totalAmountCents,
      paidAmountCents: 0,
      balanceDueCents: dto.totalAmountCents,
      status: "UNPAID",
      issueDate: dto.issueDate || new Date(),
      dueDate: dto.dueDate,
    };

    this.invoices.set(id, invoice);
    customer.outstandingBalanceCents += dto.totalAmountCents;
    customer.updatedAt = new Date();

    return invoice;
  }

  /**
   * Allocates a lump-sum corporate payment across outstanding invoices (FIFO or targeted).
   */
  async allocatePayment(
    dto: AllocatePaymentDto,
    actorId: string
  ): Promise<PaymentRecord> {
    const customer = this.customers.get(dto.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer account '${dto.customerId}' not found`);
    }

    if (dto.paymentAmountCents <= 0) {
      throw new BadRequestException("Payment amount must be greater than zero");
    }

    // Get open invoices for customer
    let openInvoices = Array.from(this.invoices.values()).filter(
      (inv) => inv.customerId === dto.customerId && inv.status !== "PAID"
    );

    if (dto.targetInvoiceIds && dto.targetInvoiceIds.length > 0) {
      openInvoices = openInvoices.filter((inv) =>
        dto.targetInvoiceIds!.includes(inv.id)
      );
    } else {
      // FIFO: Oldest due date first
      openInvoices.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }

    let remainingFunds = dto.paymentAmountCents;
    const allocations: InvoicePaymentAllocation[] = [];

    for (const inv of openInvoices) {
      if (remainingFunds <= 0) break;

      const previousBalance = inv.balanceDueCents;
      const allocate = Math.min(remainingFunds, inv.balanceDueCents);

      inv.paidAmountCents += allocate;
      inv.balanceDueCents -= allocate;
      inv.status = inv.balanceDueCents === 0 ? "PAID" : "PARTIALLY_PAID";

      allocations.push({
        id: `alloc_${crypto.randomUUID()}`,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amountCents: allocate,
        previousBalanceCents: previousBalance,
        newBalanceCents: inv.balanceDueCents,
      });

      remainingFunds -= allocate;
    }

    const appliedAmount = dto.paymentAmountCents - remainingFunds;
    customer.outstandingBalanceCents = Math.max(
      0,
      customer.outstandingBalanceCents - appliedAmount
    );

    if (remainingFunds > 0) {
      customer.unallocatedCreditCents += remainingFunds;
    }
    customer.updatedAt = new Date();

    this.paymentCounter++;
    const paymentId = `pmt_${crypto.randomUUID()}`;
    const paymentNumber = `PMT-${new Date().getFullYear()}-${this.paymentCounter}`;

    const paymentRecord: PaymentRecord = {
      id: paymentId,
      paymentNumber,
      customerId: dto.customerId,
      totalAmountCents: dto.paymentAmountCents,
      unallocatedAmountCents: remainingFunds,
      paymentMethod: dto.paymentMethod,
      referenceNumber: dto.referenceNumber,
      receivedAt: new Date(),
      receivedBy: actorId,
      allocations,
      notes: dto.notes,
    };

    this.payments.set(paymentId, paymentRecord);

    // Emit PaymentAllocated event to Kafka broker
    const broker = getKafkaBroker();
    await broker.publish("billing.payment.received", [
      {
        key: customer.id,
        value: JSON.stringify({
          eventType: "PaymentAllocated",
          paymentId: paymentRecord.id,
          paymentNumber: paymentRecord.paymentNumber,
          customerId: customer.id,
          totalAmountCents: dto.paymentAmountCents,
          allocationsCount: allocations.length,
          unallocatedCreditCents: remainingFunds,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return paymentRecord;
  }

  /**
   * Generates standard Financial Aging Reports (0-30, 31-60, 61-90, 90+ days) across customers.
   */
  async generateAgingReport(asOfDate = new Date()): Promise<CustomerAgingReport[]> {
    const reports: CustomerAgingReport[] = [];

    for (const customer of this.customers.values()) {
      const openInvoices = Array.from(this.invoices.values()).filter(
        (inv) => inv.customerId === customer.id && inv.status !== "PAID"
      );

      let current0to30Cents = 0;
      let days31to60Cents = 0;
      let days61to90Cents = 0;
      let over90DaysCents = 0;
      let oldestDate: Date | undefined;

      for (const inv of openInvoices) {
        if (!oldestDate || inv.dueDate < oldestDate) {
          oldestDate = inv.dueDate;
        }

        const daysOverdue = Math.floor(
          (asOfDate.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysOverdue <= 30) {
          current0to30Cents += inv.balanceDueCents;
        } else if (daysOverdue <= 60) {
          days31to60Cents += inv.balanceDueCents;
        } else if (daysOverdue <= 90) {
          days61to90Cents += inv.balanceDueCents;
        } else {
          over90DaysCents += inv.balanceDueCents;
        }
      }

      const totalOutstanding =
        current0to30Cents + days31to60Cents + days61to90Cents + over90DaysCents;

      reports.push({
        customerId: customer.id,
        customerName: customer.customerName,
        current0to30Cents,
        days31to60Cents,
        days61to90Cents,
        over90DaysCents,
        totalOutstandingCents: totalOutstanding,
        oldestInvoiceDueDate: oldestDate,
      });
    }

    return reports;
  }

  async getCustomerAccount(id: string): Promise<CustomerAccount | null> {
    return this.customers.get(id) || null;
  }

  async getCustomerAccounts(): Promise<CustomerAccount[]> {
    return Array.from(this.customers.values());
  }

  async getARInvoices(customerId?: string): Promise<ARInvoice[]> {
    let list = Array.from(this.invoices.values());
    if (customerId) list = list.filter((i) => i.customerId === customerId);
    return list;
  }

  async getPayments(customerId?: string): Promise<PaymentRecord[]> {
    let list = Array.from(this.payments.values());
    if (customerId) list = list.filter((p) => p.customerId === customerId);
    return list;
  }

  clear(): void {
    this.customers.clear();
    this.invoices.clear();
    this.payments.clear();
  }
}
