import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { z } from "zod";

const createTankSchema = z.object({
  name: z.string().min(1),
  capacity: z.number().positive(),
  balance: z.number().default(0),
  fuelKind: z.string().default("AUTO_DIESEL"),
  projectId: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const tanks = await prisma.bulkTank.findMany({
    orderBy: { name: "asc" },
    include: {
      project: { select: { id: true, name: true, code: true } },
      _count: {
        select: { issues: true, dips: true, requests: true },
      },
    },
  });

  return ok(tanks);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can configure bulk tanks", 403);
  }

  try {
    const body = await req.json();
    const parsed = createTankSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid bulk tank parameters", 400, parsed.error.format());
    }

    const tank = await prisma.bulkTank.create({
      data: parsed.data,
      include: { project: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.user?.id ?? null,
        action: "CREATE",
        entity: "BulkTank",
        entityId: tank.id,
        summary: `Created bulk tank ${tank.name} (${tank.fuelKind}, capacity: ${tank.capacity}L) via API`,
        metaJson: JSON.stringify(parsed.data),
      },
    });

    return ok(tank, undefined, 201);
  } catch (error) {
    console.error("[api/v1/tanks POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create bulk tank", 500);
  }
}
