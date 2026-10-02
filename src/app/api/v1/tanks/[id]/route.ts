import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const tank = await prisma.bulkTank.findUnique({
    where: { id },
    include: {
      project: true,
      users: {
        select: { id: true, name: true, username: true, role: true },
      },
      dips: {
        take: 5,
        orderBy: { dipDate: "desc" },
        include: {
          recordedBy: { select: { id: true, name: true } },
        },
      },
      requests: {
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          requestedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!tank) {
    return err("NOT_FOUND", `Tank '${id}' not found`, 404);
  }

  return ok(tank);
}
