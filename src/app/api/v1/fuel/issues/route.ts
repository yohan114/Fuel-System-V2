import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createFuelIssueSchema } from "@/lib/api/schemas";
import type { Prisma } from "@prisma/client";
import {
  formatIdempotencyKey,
  InsufficientStockError,
} from "@/lib/fuel/stock-guard";
import { executeIssueFuel } from "@/lib/commands";

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

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to record issue", 403);
    }

    const rawKey = data.idempotencyKey || req.headers.get("Idempotency-Key") || req.headers.get("X-Idempotency-Key");

    const cmdResult = await executeIssueFuel(
      {
        assetIdOrCode: data.assetId,
        fuelKind: data.fuelKind,
        litres: data.litres,
        issueDate,
        meterReading: data.meterReading ?? null,
        readingType: data.readingType,
        bulkTankId: data.bulkTankId ?? null,
        driverName: data.driverName,
        fuelRequestId: data.fuelRequestId,
        source: data.source,
        idempotencyKey: rawKey,
      },
      {
        actorId,
        actorName: auth.user?.name ?? null,
        role: auth.role,
        projectId: auth.user?.projectId ?? null,
        bulkTankId: auth.user?.bulkTankId ?? null,
      }
    );

    if (!cmdResult.success) {
      if (cmdResult.code === "INSUFFICIENT_STOCK") {
        return err("CONFLICT", cmdResult.error, 409);
      }
      if (cmdResult.code === "FORBIDDEN" || cmdResult.code === "UNAUTHORIZED_PUMP") {
        return err("FORBIDDEN", cmdResult.error, 403);
      }
      return err(cmdResult.code || "BAD_REQUEST", cmdResult.error, 400);
    }

    const created = await prisma.fuelIssue.findUnique({
      where: { id: cmdResult.data.issueId },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
        bulkTank: { select: { id: true, name: true } },
      },
    });

    return ok(created, undefined, 201);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return err("CONFLICT", error.message, 409);
    }
    console.error("[api/v1/fuel/issues POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to record fuel issue", 500);
  }
}
