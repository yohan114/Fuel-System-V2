import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const lubricants = await prisma.lubricant.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  return ok(lubricants);
}
