import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createBulkRequestSchema } from "@/lib/api/schemas";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;
  const { page, perPage, skip, take } = parsePagination(req);
  const where = { bulkTankId: id };

  const [total, requests] = await Promise.all([
    prisma.bulkRequest.count({ where }),
    prisma.bulkRequest.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true, username: true } },
        reviewedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(requests, paginationMeta(total, page, perPage));
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const { id } = await props.params;

  try {
    const body = await req.json();
    const parsed = createBulkRequestSchema.safeParse({ ...body, bulkTankId: id });
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid bulk request data", 400, parsed.error.format());
    }

    const { requestedLitres } = parsed.data;

    const tank = await prisma.bulkTank.findUnique({ where: { id } });
    if (!tank) {
      return err("NOT_FOUND", `Tank '${id}' not found`, 404);
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to request fuel", 403);
    }

    const request = await prisma.bulkRequest.create({
      data: {
        bulkTankId: id,
        fuelKind: tank.fuelKind,
        requestedLitres,
        status: "PENDING",
        sourceType: "OUTSIDE",
        requestedById: actorId,
      },
    });

    return ok(request, undefined, 201);
  } catch (error) {
    console.error("[api/v1/tanks/[id]/bulk-requests POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create bulk request", 500);
  }
}
