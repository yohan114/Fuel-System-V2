import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createFuelIssueSchema } from "@/lib/api/schemas";
import type { Prisma } from "@prisma/client";
import {
  deductTankStockAtomically,
  formatIdempotencyKey,
  findExistingIdempotentIssue,
  InsufficientStockError,
} from "@/lib/fuel/stock-guard";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") || "";
  const bulkTankId = url.searchParams.get("bulkTankId") || "";
  const fuelKind = url.searchParams.get("fuelKind") || "";
  const source = url.searchParams.get("source") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.FuelIssueWhereInput = {};
  if (assetId) where.assetId = assetId;
  if (bulkTankId) where.bulkTankId = bulkTankId;
  if (fuelKind) where.fuelKind = fuelKind;
  if (source) where.source = source;

  if (from || to) {
    where.issueDate = {};
    if (from) where.issueDate.gte = new Date(from);
    if (to) where.issueDate.lte = new Date(to);
  }

  const [total, issues] = await Promise.all([
    prisma.fuelIssue.count({ where }),
    prisma.fuelIssue.findMany({
      where,
      skip,
      take,
      omit: { photoData: true },
      orderBy: { issueDate: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true, brand: true, model: true } },
        issuedBy: { select: { id: true, name: true, username: true } },
        bulkTank: { select: { id: true, name: true } },
      },
    }),
  ]);

  return ok(issues, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  try {
    const body = await req.json();
    const parsed = createFuelIssueSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid fuel issue data", 400, parsed.error.format());
    }

    const data = parsed.data;
    const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();

    const asset = await prisma.asset.findUnique({
      where: { id: data.assetId },
      include: { project: true },
    });

    if (!asset) {
      return err("NOT_FOUND", "Asset not found", 404);
    }

    // Resolve price
    const priceRecord = await prisma.fuelPrice.findFirst({
      where: {
        fuelKind: data.fuelKind,
        effectiveFrom: { lte: issueDate },
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (!priceRecord) {
      return err("BAD_REQUEST", `No effective price found for fuel kind '${data.fuelKind}'`, 400);
    }

    const totalCost = Math.round(data.litres * priceRecord.pricePerLitre);

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to record issue", 403);
    }

    const rawKey = data.idempotencyKey || req.headers.get("Idempotency-Key") || req.headers.get("X-Idempotency-Key");
    const idempotencyKey = formatIdempotencyKey(rawKey);

    const result = await prisma.$transaction(async (tx) => {
      // Replay protection: check idempotency key
      if (idempotencyKey) {
        const existing = await findExistingIdempotentIssue(tx, idempotencyKey);
        if (existing) {
          return tx.fuelIssue.findUnique({ where: { id: existing.id } });
        }
      }

      // 1. Decrement bulk tank balance atomically if dispensed from a tank
      if (data.bulkTankId) {
        await deductTankStockAtomically(tx, data.bulkTankId, data.litres);
      }

      // 2. Create Fuel Issue
      const issue = await tx.fuelIssue.create({
        data: {
          assetId: data.assetId,
          litres: data.litres,
          fuelKind: data.fuelKind,
          pricePerLitre: priceRecord.pricePerLitre,
          totalCost,
          meterReading: data.meterReading ?? null,
          readingType: data.readingType ?? asset.meterType,
          source: data.source,
          bulkTankId: data.bulkTankId ?? null,
          issueDate,
          issuePerson: data.driverName ?? auth.user?.name ?? null,
          linkedRequestId: data.fuelRequestId ?? null,
          issuedById: actorId,
          fuelPriceId: priceRecord.id,
          importKey: idempotencyKey,
        },
      });

      // 3. Record meter reading if provided
      if (data.meterReading !== undefined && data.meterReading !== null) {
        const mr = await tx.meterReading.create({
          data: {
            assetId: data.assetId,
            value: data.meterReading,
            readingType: data.readingType ?? asset.meterType,
            readingDate: issueDate,
            source: "FUEL_ISSUE",
            recordedById: actorId,
            linkedIssueId: issue.id,
          },
        });
        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: { meterReadingRecordId: mr.id },
        });
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: auth.user?.id ?? null,
          action: "CREATE_FUEL_ISSUE",
          entity: "FuelIssue",
          entityId: issue.id,
          summary: `Dispensed ${data.litres}L of ${data.fuelKind} to ${asset.code} at Rs. ${(priceRecord.pricePerLitre / 100).toFixed(2)}/L`,
        },
      });

      return issue;
    });

    return ok(result, undefined, 201);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return err("CONFLICT", error.message, 409);
    }
    console.error("[api/v1/fuel/issues POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to record fuel issue", 500);
  }
}
