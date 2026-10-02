import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";

export async function GET(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { code } = await props.params;
  const asset = await prisma.asset.findUnique({
    where: { code: decodeURIComponent(code) },
    select: { id: true },
  });

  if (!asset) {
    return err("NOT_FOUND", `Asset with code '${code}' not found`, 404);
  }

  const { page, perPage, skip, take } = parsePagination(req);
  const where = { assetId: asset.id };

  const [total, services] = await Promise.all([
    prisma.serviceRecord.count({ where }),
    prisma.serviceRecord.findMany({
      where,
      skip,
      take,
      orderBy: { serviceDate: "desc" },
      include: {
        recordedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(services, paginationMeta(total, page, perPage));
}
