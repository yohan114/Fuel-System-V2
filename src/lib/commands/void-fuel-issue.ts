import { prisma } from "@/lib/db";
import { periodKeyFor, logFuelIssueChange } from "@/lib/fuel/audit";
import { resolvePeriod } from "@/lib/billing/period";
import { generateBillForAsset } from "@/lib/billing/generate";
import { adjustTankStockAtomically } from "@/lib/fuel/stock-guard";
import type { CommandContext, CommandResult } from "./types";

export interface VoidFuelIssueCommand {
  issueId: string;
  reason: string;
  voided?: boolean; // true to void, false to unvoid/restore (defaults to true)
}

export interface VoidFuelIssueResult {
  issueId: string;
  assetCode: string;
  litres: number;
  voided: boolean;
  tankDeltaLitres?: number;
  tankName?: string | null;
  billNote: string;
}

/**
 * Authoritative VoidFuelIssue / RestoreFuelIssue application command (Master Plan DOM-01 / Section 8).
 *
 * Enforces:
 * 1. Administrator authority
 * 2. Audit reason requirement
 * 3. Closed-period check (refuses voiding if the invoice is ISSUED/PAID/OVERDUE)
 * 4. Atomic stock reversal (returns fuel to bulk tank or withdraws it on unvoid)
 * 5. Structured audit logging
 * 6. Automatic draft invoice regeneration
 */
export async function executeVoidFuelIssue(
  cmd: VoidFuelIssueCommand,
  ctx: CommandContext
): Promise<CommandResult<VoidFuelIssueResult>> {
  if (ctx.role !== "ADMIN") {
    return { success: false, error: "Only an administrator may void or restore a fuel issue", code: "FORBIDDEN" };
  }

  const voided = cmd.voided ?? true;
  const reason = (cmd.reason ?? "").trim();
  if (voided && reason.length < 4) {
    return { success: false, error: "Give a reason for voiding this issue — it goes on the record.", code: "REASON_REQUIRED" };
  }

  const issue = await prisma.fuelIssue.findUnique({
    where: { id: cmd.issueId },
    include: {
      asset: { select: { id: true, code: true } },
      bulkTank: { select: { id: true, name: true, balance: true } },
    },
  });

  if (!issue) {
    return { success: false, error: "Fuel issue not found", code: "NOT_FOUND" };
  }

  if (issue.voided === voided) {
    return {
      success: false,
      error: voided ? "That issue is already voided." : "That issue is not voided.",
      code: "ALREADY_IN_STATE",
    };
  }

  const periodKey = periodKeyFor(issue.issueDate);
  const [y, m] = periodKey.split("-").map(Number);

  // Closed-period protection: An invoice the client already holds cannot quietly lose its fuel.
  const bill = await prisma.bill.findUnique({
    where: { assetId_year_month: { assetId: issue.assetId, year: y, month: m } },
    select: { status: true, invoiceNumber: true },
  });

  if (bill && bill.status !== "DRAFT") {
    return {
      success: false,
      error:
        `${issue.asset.code}'s ${periodKey} invoice is ${bill.status}` +
        `${bill.invoiceNumber ? ` (${bill.invoiceNumber})` : ""} and has gone to the client. ` +
        `Raise a credit note rather than voiding the fuel behind it.`,
      code: "CLOSED_PERIOD",
    };
  }

  // Stock reversal delta: voiding returns fuel (+); restoring draws it back (-)
  const delta = voided ? issue.litres : -issue.litres;
  if (!voided && issue.bulkTank && issue.bulkTank.balance < issue.litres) {
    return {
      success: false,
      error:
        `${issue.bulkTank.name} holds ${issue.bulkTank.balance.toFixed(1)} L, ` +
        `less than the ${issue.litres} L restoring this issue would take back out.`,
      code: "INSUFFICIENT_STOCK",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.fuelIssue.update({
        where: { id: issue.id },
        data: { voided, voidedAt: voided ? new Date() : null },
      });

      if (issue.bulkTankId) {
        await adjustTankStockAtomically(tx, issue.bulkTankId, delta, issue.bulkTank?.name);
      }

      await logFuelIssueChange(tx, ctx.actorId, issue.asset.code, {
        action: voided ? "VOID" : "UNVOID",
        issueId: issue.id,
        changes: [{ field: "voided", from: !voided, to: voided }],
        tankDeltaLitres: issue.bulkTankId ? delta : undefined,
        tankId: issue.bulkTankId,
        tankName: issue.bulkTank?.name ?? null,
        meterReading: "unchanged",
        periodKey,
        reason: reason || null,
      });
    });

    // Redo draft bill if one exists
    let billNote = "";
    try {
      const r = await generateBillForAsset(issue.assetId, resolvePeriod(y, m), {
        regenerate: true,
        actorId: ctx.actorId,
      });
      if (r.status === "skipped-not-here") {
        billNote = ` Its ${periodKey} draft bill was removed — no fuel left that month.`;
      } else if (r.status === "regenerated" || r.status === "created") {
        billNote = ` Its ${periodKey} draft bill was redone.`;
      }
    } catch (err) {
      console.error("[executeVoidFuelIssue] Bill regeneration after void failed:", err);
      billNote = ` The ${periodKey} bill could not be redone automatically — regenerate the month.`;
    }

    return {
      success: true,
      data: {
        issueId: issue.id,
        assetCode: issue.asset.code,
        litres: issue.litres,
        voided,
        tankDeltaLitres: issue.bulkTankId ? delta : undefined,
        tankName: issue.bulkTank?.name ?? null,
        billNote,
      },
      message:
        `${issue.asset.code}'s ${issue.litres} L issue ${voided ? "voided" : "restored"}.` +
        (issue.bulkTank ? ` ${Math.abs(delta)} L ${voided ? "returned to" : "taken from"} ${issue.bulkTank.name}.` : "") +
        billNote,
    };
  } catch (error: unknown) {
    console.error("[executeVoidFuelIssue] Transaction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to void fuel issue",
      code: "TRANSACTION_FAILED",
    };
  }
}
