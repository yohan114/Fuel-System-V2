import { prisma } from "@/lib/db";
import { getBillingConfig } from "@/lib/billing/config";
import { billClarifyReasons } from "@/lib/billing/clarify";
import { nextInvoiceNumber } from "@/lib/billing/invoice-number";
import type { CommandContext, CommandResult } from "./types";

export interface IssueInvoiceCommand {
  billId: string;
  overrideReason?: string | null;
}

export interface IssueInvoiceResult {
  billId: string;
  invoiceNumber: string;
  issuedDate: Date;
  dueDate: Date;
  assetCode: string;
  periodKey: string;
}

/**
 * Authoritative IssueInvoice application command (Master Plan DOM-01 / Section 8).
 *
 * Enforces:
 * 1. Administrator authorization
 * 2. Status verification (DRAFT only)
 * 3. Clarification gate: if clarification issues exist, an override reason is required
 * 4. Concurrency-safe invoice sequence generation
 * 5. Atomic bill finalization
 * 6. Structured audit logging
 */
export async function executeIssueInvoice(
  cmd: IssueInvoiceCommand,
  ctx: CommandContext
): Promise<CommandResult<IssueInvoiceResult>> {
  if (ctx.role !== "ADMIN") {
    return { success: false, error: "Only an administrator can issue invoices", code: "FORBIDDEN" };
  }

  const draft = await prisma.bill.findUnique({ where: { id: cmd.billId } });
  if (!draft) {
    return { success: false, error: "Bill not found", code: "NOT_FOUND" };
  }

  if (draft.status !== "DRAFT") {
    return { success: false, error: "Only draft bills can be issued", code: "ALREADY_ISSUED" };
  }

  // Clarification gate
  const reasons = billClarifyReasons(draft);
  const reason = cmd.overrideReason?.trim();
  if (reasons.length > 0 && !reason) {
    return {
      success: false,
      blocked: true,
      reasons,
      error: "Invoice requires clarification override",
      code: "CLARIFICATION_REQUIRED",
    };
  }

  const cfg = await getBillingConfig();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: cmd.billId } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "DRAFT") throw new Error("Only draft bills can be issued");

      const invoiceNumber = await nextInvoiceNumber(tx, cfg.invoicePrefix, bill.year);
      const issuedDate = new Date();
      const dueDate = new Date(issuedDate.getTime() + cfg.dueDays * 24 * 60 * 60 * 1000);

      const overrideNote =
        reasons.length > 0 && reason
          ? `${bill.notes ? bill.notes + " · " : ""}Issued with override: ${reason}`
          : bill.notes;

      await tx.bill.update({
        where: { id: cmd.billId },
        data: {
          status: "ISSUED",
          invoiceNumber,
          issuedDate,
          dueDate,
          notes: overrideNote,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: ctx.actorId,
          action: "UPDATE",
          entity: "Bill",
          entityId: cmd.billId,
          summary:
            reasons.length > 0 && reason
              ? `Issued invoice ${invoiceNumber} for ${bill.assetCode} (${bill.periodKey}) — OVERRIDE despite ${reasons.length} clarification flag(s): ${reason}`
              : `Issued invoice ${invoiceNumber} for ${bill.assetCode} (${bill.periodKey})`,
          metaJson: JSON.stringify({
            invoiceNumber,
            year: bill.year,
            month: bill.month,
            grandTotalCents: bill.grandTotalCents,
            clarifications: reasons,
            overrideReason: reason || null,
          }),
        },
      });

      return {
        billId: bill.id,
        invoiceNumber,
        issuedDate,
        dueDate,
        assetCode: bill.assetCode,
        periodKey: bill.periodKey,
      };
    });

    return { success: true, data: result };
  } catch (error: unknown) {
    console.error("[executeIssueInvoice] Transaction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to issue invoice",
      code: "TRANSACTION_FAILED",
    };
  }
}
