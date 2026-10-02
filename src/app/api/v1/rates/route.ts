import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const equipType = url.searchParams.get("equipType");

  const rates = await prisma.rentalRate.findMany({
    where: {
      ...(equipType ? { equipType } : {}),
    },
    include: {
      asset: {
        select: {
          id: true,
          code: true,
          brand: true,
          model: true,
          meterType: true,
          category: { select: { id: true, code: true, name: true } },
          project: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: { asset: { code: "asc" } },
  });

  return ok(rates);
}
