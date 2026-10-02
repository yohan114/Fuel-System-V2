import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";

export async function GET(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { code } = await props.params;
  const category = await prisma.category.findUnique({
    where: { code: decodeURIComponent(code).toUpperCase() },
    select: { id: true, code: true, name: true },
  });

  if (!category) {
    return err("NOT_FOUND", `Category '${code}' not found`, 404);
  }

  const tasks = await prisma.pMTask.findMany({
    where: { categoryId: category.id },
    orderBy: [
      { intervalHours: "asc" },
      { sortOrder: "asc" },
    ],
  });

  return ok({
    category,
    tasks,
  });
}
