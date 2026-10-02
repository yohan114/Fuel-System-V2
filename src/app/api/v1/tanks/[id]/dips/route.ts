import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createTankDipSchema } from "@/lib/api/schemas";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;
  const { page, perPage, skip, take } = parsePagination(req);
  const where = { bulkTankId: id };

  const [total, dips] = await Promise.all([
    prisma.tankDip.count({ where }),
    prisma.tankDip.findMany({
      where,
      skip,
      take,
      orderBy: { dipDate: "desc" },
      include: {
        recordedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(dips, paginationMeta(total, page, perPage));
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
    const parsed = createTankDipSchema.safeParse({ ...body, tankId: id });
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid dip data", 400, parsed.error.format());
    }

    const { dipLitres, litresCalculated, dipDate, note, notes } = parsed.data;

    const tank = await prisma.bulkTank.findUnique({ where: { id } });
    if (!tank) {
      return err("NOT_FOUND", `Tank '${id}' not found`, 404);
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to record dip", 403);
    }

    const measuredLitres = dipLitres ?? litresCalculated ?? 0;
    const computedBalance = tank.balance;
    const variance = measuredLitres - computedBalance;

    const dip = await prisma.tankDip.create({
      data: {
        bulkTankId: id,
        dipLitres: measuredLitres,
        computedBalance,
        variance,
        dipDate: dipDate ? new Date(dipDate) : new Date(),
        note: note || notes || null,
        recordedById: actorId,
      },
    });

    return ok(dip, undefined, 201);
  } catch (error) {
    console.error("[api/v1/tanks/[id]/dips POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to record tank dip", 500);
  }
}
