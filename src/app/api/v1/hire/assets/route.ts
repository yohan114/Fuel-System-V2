import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const assets = await prisma.asset.findMany({
    where: {
      hireSupplier: { not: null },
      status: { in: ["ACTIVE", "INACTIVE"] },
    },
    select: {
      id: true,
      code: true,
      brand: true,
      model: true,
      regNo: true,
      meterType: true,
      hireSupplier: true,
      hireRateCents: true,
      hireRateBasis: true,
      hireStart: true,
      hireEnd: true,
      hireNote: true,
      project: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, name: true, code: true } },
    },
    orderBy: { code: "asc" },
  });

  return ok(assets);
}
