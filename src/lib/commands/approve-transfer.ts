import { prisma } from "@/lib/db";
import {
  transferTankStockAtomically,
  creditTankStockAtomically,
  InsufficientStockError,
} from "@/lib/fuel/stock-guard";
import type { CommandContext, CommandResult } from "./types";

export interface ApproveTransferCommand {
  requestId: string;
  reviewNote?: string | null;
}

export interface ApproveTransferResult {
  requestId: string;
  litres: number;
  sourceType: string;
  sourceTankName?: string | null;
  targetTankName: string;
  status: "APPROVED";
}

/**
 * Authoritative ApproveTransfer application command (Master Plan DOM-01 / Section 8).
 *
 * Enforces in a single database transaction:
 * 1. Administrator authorization
 * 2. Status verification (PENDING only)
 * 3. Conditional debit from source tank (preventing negative balance)
 * 4. Atomic credit to target tank
 * 5. Structured audit logging
 */
export async function executeApproveTransfer(
  cmd: ApproveTransferCommand,
  ctx: CommandContext
): Promise<CommandResult<ApproveTransferResult>> {
  if (ctx.role !== "ADMIN") {
    return { success: false, error: "Only an administrator can approve fuel transfers", code: "FORBIDDEN" };
  }

  const req = await prisma.bulkRequest.findUnique({
    where: { id: cmd.requestId },
    include: { bulkTank: true, sourceTank: true },
  });

  if (!req) {
    return { success: false, error: "Bulk request not found", code: "NOT_FOUND" };
  }

  if (req.status !== "PENDING") {
    return { success: false, error: "Bulk request has already been processed", code: "ALREADY_PROCESSED" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bulkRequest.update({
        where: { id: req.id },
        data: {
          status: "APPROVED",
          reviewedById: ctx.actorId,
          reviewedAt: new Date(),
          reviewNote: cmd.reviewNote ?? null,
        },
      });

      if (req.sourceType === "SITE" && req.sourceTankId) {
        // Inter-site transfer: atomically draw from source tank and credit target
        const sourceName = req.sourceTank?.name;
        await transferTankStockAtomically(
          tx,
          req.sourceTankId,
          req.bulkTankId,
          req.requestedLitres,
          sourceName,
          req.bulkTank.name
        );

        await tx.auditLog.create({
          data: {
            actorId: ctx.actorId,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: req.id,
            summary: `Approved fuel transfer of ${req.requestedLitres}L from site "${sourceName || "source"}" to "${req.bulkTank.name}"`,
            metaJson: JSON.stringify({
              sourceTankId: req.sourceTankId,
              targetTankId: req.bulkTankId,
              litres: req.requestedLitres,
            }),
          },
        });
      } else {
        // Direct receipt into target tank
        await creditTankStockAtomically(tx, req.bulkTankId, req.requestedLitres);

        await tx.auditLog.create({
          data: {
            actorId: ctx.actorId,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: req.id,
            summary: `Approved outside-purchase delivery of ${req.requestedLitres}L to "${req.bulkTank.name}"`,
            metaJson: JSON.stringify({
              targetTankId: req.bulkTankId,
              litres: req.requestedLitres,
            }),
          },
        });
      }
    });

    return {
      success: true,
      data: {
        requestId: req.id,
        litres: req.requestedLitres,
        sourceType: req.sourceType,
        sourceTankName: req.sourceTank?.name ?? null,
        targetTankName: req.bulkTank.name,
        status: "APPROVED",
      },
      message: `Approved transfer of ${req.requestedLitres}L to ${req.bulkTank.name}`,
    };
  } catch (error: unknown) {
    if (error instanceof InsufficientStockError) {
      return { success: false, error: error.message, code: "INSUFFICIENT_STOCK" };
    }
    console.error("[executeApproveTransfer] Transaction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to approve transfer",
      code: "TRANSACTION_FAILED",
    };
  }
}
