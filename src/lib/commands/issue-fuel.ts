import { prisma } from "@/lib/db";
import { canUserAccessAsset } from "@/lib/assignments";
import { isSiteUser } from "@/lib/roles";
import { resolveIssueAuthority } from "@/lib/fuel/issue-authority";
import { getPriceForDate } from "@/lib/pricing";
import { checkDailyCap } from "@/lib/fuel-policy";
import { checkFuelMeter } from "@/lib/fuel/meter-guard";
import {
  deductTankStockAtomically,
  formatIdempotencyKey,
  findExistingIdempotentIssue,
  InsufficientStockError,
} from "@/lib/fuel/stock-guard";
import type { CommandContext, CommandResult } from "./types";

export interface IssueFuelCommand {
  assetIdOrCode: string;
  fuelKind: string;
  litres: number;
  issueDate?: Date;
  meterReading?: number | null;
  readingType?: string | null;
  bulkTankId?: string | null;
  driverName?: string | null;
  fuelRequestId?: string | null;
  idempotencyKey?: string | null;
  source?: string | null;
  photo?: { data: Uint8Array | Buffer; name: string; mime: string } | null;
}

export interface IssueFuelResult {
  issueId: string;
  litres: number;
  fuelKind: string;
  totalCost: number;
  pricePerLitre: number;
  assetCode: string;
  bulkTankName?: string | null;
}

/**
 * Authoritative IssueFuel application command (Master Plan DOM-01 / Section 8).
 *
 * Enforces in a single database transaction:
 * 1. Authority validation
 * 2. Meter continuity & outage verification
 * 3. Daily vehicle allocation cap validation
 * 4. Price resolution for the effective issue date
 * 5. Replay protection (idempotency key)
 * 6. Atomic stock lock & balance deduction
 * 7. FuelIssue & MeterReading creation
 * 8. Audit logging
 */
export async function executeIssueFuel(
  cmd: IssueFuelCommand,
  ctx: CommandContext
): Promise<CommandResult<IssueFuelResult>> {
  const litres = cmd.litres;
  if (!litres || isNaN(litres) || litres <= 0) {
    return { success: false, error: "Litres must be greater than zero", code: "INVALID_QUANTITY" };
  }

  const issueDate = cmd.issueDate ?? new Date();

  // 1. Resolve or quick-add asset
  const query = cmd.assetIdOrCode.trim().toUpperCase();
  let asset = await prisma.asset.findFirst({
    where: {
      OR: [{ id: cmd.assetIdOrCode }, { code: query }, { regNo: query }],
    },
  });

  if (!asset) {
    const otherCategory = await prisma.category.findFirst({
      where: { code: "OTHER" },
    });
    if (!otherCategory) {
      return { success: false, error: "Fallback asset category 'OTHER' is missing", code: "CONFIGURATION_ERROR" };
    }
    asset = await prisma.asset.create({
      data: {
        code: query,
        categoryId: otherCategory.id,
        meterType: cmd.readingType ?? "KM",
        status: "ACTIVE",
        brand: "Quick Added",
        typeLabel: "Other Asset",
      },
    });
  }

  // 2. Site-scoped user verification
  if (isSiteUser(ctx.role) && ctx.projectId) {
    const hasAccess = await canUserAccessAsset(
      { role: ctx.role, projectId: ctx.projectId },
      asset.id,
      issueDate
    );
    if (!hasAccess) {
      return { success: false, error: "This vehicle is not allocated to your site.", code: "FORBIDDEN" };
    }
  }

  // 3. Outage & Meter continuity checks
  const activeOutage = await prisma.meterOutage.findFirst({
    where: {
      assetId: asset.id,
      endDate: null,
      startDate: { lte: issueDate },
    },
  });

  const meterReading = cmd.meterReading ?? null;
  if (meterReading !== null) {
    if (isNaN(meterReading) || meterReading < 0) {
      return { success: false, error: "Meter reading must be positive", code: "INVALID_METER" };
    }

    if (!activeOutage) {
      const readingType = cmd.readingType ?? asset.meterType;
      const guard = await checkFuelMeter(prisma, asset.id, readingType, meterReading, issueDate);
      if (!guard.ok) {
        return { success: false, error: guard.error ?? "Meter reading continuity violated", code: "METER_GUARD_FAILED" };
      }
    }
  }

  // 4. Daily Cap Check
  const capError = await checkDailyCap(asset.id, asset.dailyCapLitres, issueDate, litres);
  if (capError) {
    return { success: false, error: capError, code: "DAILY_CAP_EXCEEDED" };
  }

  // 5. Pump Authority Resolution
  let ownTankId = ctx.bulkTankId;
  if (!ownTankId && ctx.projectId) {
    const siteTank = await prisma.bulkTank.findFirst({ where: { projectId: ctx.projectId } });
    if (siteTank) ownTankId = siteTank.id;
  }

  const authority = resolveIssueAuthority({
    role: ctx.role,
    ownTankId,
    targetTankId: cmd.bulkTankId,
  });
  if (!authority.allowed) {
    return { success: false, error: authority.error ?? "Pump access denied", code: "UNAUTHORIZED_PUMP" };
  }

  const effectiveTankId = authority.tankId;
  let tank: { id: string; name: string; balance: number; fuelKind: string } | null = null;
  let source = cmd.source || "Station Purchase";

  if (effectiveTankId) {
    tank = await prisma.bulkTank.findUnique({
      where: { id: effectiveTankId },
      select: { id: true, name: true, balance: true, fuelKind: true },
    });
    if (!tank) {
      return { success: false, error: "Target pump / bulk tank not found", code: "NOT_FOUND" };
    }
    if (tank.fuelKind && tank.fuelKind !== cmd.fuelKind) {
      return {
        success: false,
        error: `${tank.name} holds ${tank.fuelKind.replace(/_/g, " ").toLowerCase()}, not ${cmd.fuelKind.replace(/_/g, " ").toLowerCase()}.`,
        code: "FUEL_KIND_MISMATCH",
      };
    }
    if (tank.balance < litres) {
      return {
        success: false,
        error: `${tank.name} holds ${tank.balance.toFixed(1)} L — less than the ${litres} L being issued.`,
        code: "INSUFFICIENT_STOCK",
      };
    }
    source = tank.name;
  }

  // 6. Price Resolution
  const resolvedPrice = await getPriceForDate(cmd.fuelKind, issueDate);
  const totalCost = Math.round(litres * resolvedPrice.pricePerLitre);

  const idempotencyKey = formatIdempotencyKey(cmd.idempotencyKey);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Replay protection: check existing idempotency key
      if (idempotencyKey) {
        const existing = await findExistingIdempotentIssue(tx, idempotencyKey);
        if (existing) {
          return {
            issueId: existing.id,
            litres: existing.litres,
            fuelKind: existing.fuelKind ?? cmd.fuelKind,
            totalCost: existing.totalCost ?? totalCost,
            pricePerLitre: existing.pricePerLitre ?? resolvedPrice.pricePerLitre,
            assetCode: asset.code,
            bulkTankName: tank?.name ?? null,
          };
        }
      }

      // Deduct atomically from tank if dispensing from bulk
      if (effectiveTankId) {
        await deductTankStockAtomically(tx, effectiveTankId, litres, tank?.name);
      }

      // Create FuelIssue
      const issue = await tx.fuelIssue.create({
        data: {
          assetId: asset.id,
          litres,
          fuelKind: cmd.fuelKind,
          pricePerLitre: resolvedPrice.pricePerLitre,
          totalCost,
          meterReading,
          readingType: cmd.readingType ?? asset.meterType,
          source,
          issueDate,
          issuedById: ctx.actorId,
          issuePerson: cmd.driverName ?? ctx.actorName ?? null,
          fuelPriceId: resolvedPrice.id,
          bulkTankId: effectiveTankId ?? null,
          linkedRequestId: cmd.fuelRequestId ?? null,
          importKey: idempotencyKey,
          ...(cmd.photo ? { photoData: new Uint8Array(cmd.photo.data), photoName: cmd.photo.name, photoMime: cmd.photo.mime } : {}),
        },
      });

      // Link meter reading
      if (meterReading !== null) {
        const mr = await tx.meterReading.create({
          data: {
            assetId: asset.id,
            value: meterReading,
            readingType: cmd.readingType ?? asset.meterType,
            readingDate: issueDate,
            source: activeOutage ? "GOOGLE_ESTIMATE" : "FUEL_ISSUE",
            recordedById: ctx.actorId,
            linkedIssueId: issue.id,
          },
        });

        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: { meterReadingRecordId: mr.id },
        });
      }

      // Structured Audit Log
      await tx.auditLog.create({
        data: {
          actorId: ctx.actorId,
          action: "CREATE",
          entity: "FuelIssue",
          entityId: issue.id,
          summary: `Dispensed ${litres}L of ${cmd.fuelKind} to ${asset.code}${tank ? ` from ${tank.name}` : ""} at Rs. ${(resolvedPrice.pricePerLitre / 100).toFixed(2)}/L`,
          metaJson: JSON.stringify({
            assetCode: asset.code,
            litres,
            fuelKind: cmd.fuelKind,
            source,
            bulkTankId: effectiveTankId ?? null,
            totalCost,
          }),
        },
      });

      return {
        issueId: issue.id,
        litres: issue.litres ?? litres,
        fuelKind: issue.fuelKind ?? cmd.fuelKind,
        totalCost: issue.totalCost ?? totalCost,
        pricePerLitre: issue.pricePerLitre ?? resolvedPrice.pricePerLitre,
        assetCode: asset.code,
        bulkTankName: tank?.name ?? null,
      };
    });

    return { success: true, data: result };
  } catch (error: unknown) {
    if (error instanceof InsufficientStockError) {
      return { success: false, error: error.message, code: "INSUFFICIENT_STOCK" };
    }
    console.error("[executeIssueFuel] Transaction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to record fuel issue",
      code: "TRANSACTION_FAILED",
    };
  }
}
