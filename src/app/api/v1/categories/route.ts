import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const categories = await prisma.category.findMany({
    orderBy: { code: "asc" },
    include: {
      _count: {
        select: { assets: true },
      },
      serviceInterval: true,
    },
  });

  return ok(categories);
}
