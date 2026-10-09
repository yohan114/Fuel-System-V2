// ============================================================================
// Phase 19 / Wave F: General Ledger (GL) Export Application Service
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Encapsulates double-entry journal generation, zero-imbalance trial balance validation,
// and corporate ERP export serialization (SAP / Oracle / QuickBooks / Xero).
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import crypto from "crypto";
import {
  CHART_OF_ACCOUNTS,
  type JournalBatch,
  type JournalEntryLine,
  type GenerateJournalBatchDto,
  type GLExportResult,
} from "./types";
import { getKafkaBroker } from "@/lib/events/kafka-producer";

@Injectable()
export class GLExportService {
  private batches = new Map<string, JournalBatch>();
  private batchCounter = 100;

  /**
   * Generates a balanced double-entry General Ledger journal batch.
   */
  async generateJournalBatch(
    dto: GenerateJournalBatchDto,
    actorId: string
  ): Promise<JournalBatch> {
    const lines: JournalEntryLine[] = [];
    const dateStr = dto.period;

    // 1. Fuel Issues: Debit Equipment Fuel Expense, Credit Fuel Inventory
    if (dto.fuelIssues) {
      for (const issue of dto.fuelIssues) {
        if (issue.costCents <= 0) continue;

        // Debit Operating Expense
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.FUEL_OPERATING_EXPENSE.code,
          accountName: CHART_OF_ACCOUNTS.FUEL_OPERATING_EXPENSE.name,
          debitCents: issue.costCents,
          creditCents: 0,
          description: `Fuel consumption for asset ${issue.assetId}`,
          referenceId: issue.id,
          entityId: issue.assetId,
        });

        // Credit Inventory
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.FUEL_INVENTORY.code,
          accountName: CHART_OF_ACCOUNTS.FUEL_INVENTORY.name,
          debitCents: 0,
          creditCents: issue.costCents,
          description: `Bulk fuel issued from tank inventory`,
          referenceId: issue.id,
          entityId: issue.assetId,
        });
      }
    }

    // 2. Fuel Delivery Receipts: Debit Fuel Inventory, Credit Accounts Payable
    if (dto.fuelReceipts) {
      for (const receipt of dto.fuelReceipts) {
        if (receipt.costCents <= 0) continue;

        // Debit Fuel Inventory
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.FUEL_INVENTORY.code,
          accountName: CHART_OF_ACCOUNTS.FUEL_INVENTORY.name,
          debitCents: receipt.costCents,
          creditCents: 0,
          description: `Fuel replenishment receipt from supplier ${receipt.supplierId}`,
          referenceId: receipt.id,
          entityId: receipt.supplierId,
        });

        // Credit Accounts Payable
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE.code,
          accountName: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE.name,
          debitCents: 0,
          creditCents: receipt.costCents,
          description: `Supplier invoice payable for fuel delivery`,
          referenceId: receipt.id,
          entityId: receipt.supplierId,
        });
      }
    }

    // 3. Customer Billing Invoices: Debit AR, Credit Hire Revenue & Fuel Revenue
    if (dto.invoices) {
      for (const inv of dto.invoices) {
        const totalInvoiceCents = inv.hireCents + inv.fuelCents;
        if (totalInvoiceCents <= 0) continue;

        // Debit Accounts Receivable
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE.code,
          accountName: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE.name,
          debitCents: totalInvoiceCents,
          creditCents: 0,
          description: `Customer invoice receivable for customer ${inv.customerId}`,
          referenceId: inv.id,
          entityId: inv.customerId,
        });

        // Credit Hire Revenue
        if (inv.hireCents > 0) {
          lines.push({
            id: `line_${crypto.randomUUID()}`,
            accountCode: CHART_OF_ACCOUNTS.HIRE_REVENUE.code,
            accountName: CHART_OF_ACCOUNTS.HIRE_REVENUE.name,
            debitCents: 0,
            creditCents: inv.hireCents,
            description: `Plant hire revenue`,
            referenceId: inv.id,
            entityId: inv.customerId,
          });
        }

        // Credit Fuel Revenue
        if (inv.fuelCents > 0) {
          lines.push({
            id: `line_${crypto.randomUUID()}`,
            accountCode: CHART_OF_ACCOUNTS.FUEL_REVENUE.code,
            accountName: CHART_OF_ACCOUNTS.FUEL_REVENUE.name,
            debitCents: 0,
            creditCents: inv.fuelCents,
            description: `Fuel sales revenue`,
            referenceId: inv.id,
            entityId: inv.customerId,
          });
        }
      }
    }

    // 4. Customer Payments: Debit Cash & Bank, Credit Accounts Receivable
    if (dto.payments) {
      for (const pmt of dto.payments) {
        if (pmt.amountCents <= 0) continue;

        // Debit Cash & Bank
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.CASH_AND_BANK.code,
          accountName: CHART_OF_ACCOUNTS.CASH_AND_BANK.name,
          debitCents: pmt.amountCents,
          creditCents: 0,
          description: `Payment receipt from customer ${pmt.customerId}`,
          referenceId: pmt.id,
          entityId: pmt.customerId,
        });

        // Credit Accounts Receivable
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE.code,
          accountName: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE.name,
          debitCents: 0,
          creditCents: pmt.amountCents,
          description: `Accounts receivable settlement`,
          referenceId: pmt.id,
          entityId: pmt.customerId,
        });
      }
    }

    // 5. Maintenance Work Orders: Debit Maintenance Expense, Credit Parts & Labor Clearing
    if (dto.maintenanceWorkOrders) {
      for (const wo of dto.maintenanceWorkOrders) {
        const totalWOCents = wo.partsCostCents + wo.laborCostCents;
        if (totalWOCents <= 0) continue;

        // Debit Maintenance Expense
        lines.push({
          id: `line_${crypto.randomUUID()}`,
          accountCode: CHART_OF_ACCOUNTS.MAINTENANCE_EXPENSE.code,
          accountName: CHART_OF_ACCOUNTS.MAINTENANCE_EXPENSE.name,
          debitCents: totalWOCents,
          creditCents: 0,
          description: `Equipment maintenance overhaul for asset ${wo.assetId}`,
          referenceId: wo.id,
          entityId: wo.assetId,
        });

        // Credit Parts Inventory
        if (wo.partsCostCents > 0) {
          lines.push({
            id: `line_${crypto.randomUUID()}`,
            accountCode: CHART_OF_ACCOUNTS.PARTS_INVENTORY.code,
            accountName: CHART_OF_ACCOUNTS.PARTS_INVENTORY.name,
            debitCents: 0,
            creditCents: wo.partsCostCents,
            description: `Spare parts consumed from store inventory`,
            referenceId: wo.id,
            entityId: wo.assetId,
          });
        }

        // Credit Labor Clearing
        if (wo.laborCostCents > 0) {
          lines.push({
            id: `line_${crypto.randomUUID()}`,
            accountCode: CHART_OF_ACCOUNTS.WORKSHOP_LABOR_CLEARING.code,
            accountName: CHART_OF_ACCOUNTS.WORKSHOP_LABOR_CLEARING.name,
            debitCents: 0,
            creditCents: wo.laborCostCents,
            description: `Internal workshop mechanic labor cost recovery`,
            referenceId: wo.id,
            entityId: wo.assetId,
          });
        }
      }
    }

    if (lines.length === 0) {
      throw new BadRequestException("Cannot generate empty General Ledger journal batch");
    }

    // Calculate trial balance totals
    let totalDebitsCents = 0;
    let totalCreditsCents = 0;

    for (const l of lines) {
      totalDebitsCents += l.debitCents;
      totalCreditsCents += l.creditCents;
    }

    // Zero-imbalance validation
    if (totalDebitsCents !== totalCreditsCents) {
      throw new BadRequestException(
        `Trial balance imbalance: Debits (${(totalDebitsCents / 100).toFixed(2)}) do not match Credits (${(totalCreditsCents / 100).toFixed(2)})`
      );
    }

    this.batchCounter++;
    const batchId = `gl_batch_${crypto.randomUUID()}`;
    const batchNumber = `GL-${dto.period.replace(/[^0-9]/g, "")}-${this.batchCounter}`;

    const batch: JournalBatch = {
      id: batchId,
      batchNumber,
      period: dto.period,
      sourceModule: dto.sourceModule || "COMBINED",
      lines,
      totalDebitsCents,
      totalCreditsCents,
      isBalanced: true,
      postedAt: new Date(),
      postedBy: actorId,
      notes: dto.notes,
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  /**
   * Exports a General Ledger journal batch into standard corporate CSV format.
   */
  async exportBatchToCSV(batchId: string): Promise<GLExportResult> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new NotFoundException(`General Ledger journal batch '${batchId}' not found`);
    }

    const header = "BatchNumber,Date,AccountCode,AccountName,Debit,Credit,Reference,Entity,Description";
    const rows = batch.lines.map((l) => {
      const debitStr = (l.debitCents / 100).toFixed(2);
      const creditStr = (l.creditCents / 100).toFixed(2);
      const dateStr = batch.postedAt.toISOString().slice(0, 10);
      const desc = `"${l.description.replace(/"/g, '""')}"`;
      return `${batch.batchNumber},${dateStr},${l.accountCode},"${l.accountName}",${debitStr},${creditStr},${l.referenceId || ""},${l.entityId || ""},${desc}`;
    });

    const csvContent = [header, ...rows].join("\n");
    batch.exportedAt = new Date();

    // Emit GLJournalBatchExported event to Kafka broker
    const broker = getKafkaBroker();
    await broker.publish("billing.invoice.generated", [
      {
        key: batch.period,
        value: JSON.stringify({
          eventType: "GLJournalBatchExported",
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          period: batch.period,
          recordCount: batch.lines.length,
          totalAmountCents: batch.totalDebitsCents,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      format: "CSV",
      csvContent,
      recordCount: batch.lines.length,
      totalDebitsCents: batch.totalDebitsCents,
      totalCreditsCents: batch.totalCreditsCents,
    };
  }

  /**
   * Exports a General Ledger journal batch as structured JSON.
   */
  async exportBatchToJSON(batchId: string): Promise<GLExportResult> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new NotFoundException(`General Ledger journal batch '${batchId}' not found`);
    }

    batch.exportedAt = new Date();

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      format: "JSON",
      jsonData: batch,
      recordCount: batch.lines.length,
      totalDebitsCents: batch.totalDebitsCents,
      totalCreditsCents: batch.totalCreditsCents,
    };
  }

  async getJournalBatches(period?: string): Promise<JournalBatch[]> {
    let list = Array.from(this.batches.values());
    if (period) {
      list = list.filter((b) => b.period === period);
    }
    return list;
  }

  async getJournalBatch(id: string): Promise<JournalBatch | null> {
    return this.batches.get(id) || null;
  }

  clear(): void {
    this.batches.clear();
  }
}
