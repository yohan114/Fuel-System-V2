import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";

export async function GET(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
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

  const [total, issues] = await Promise.all([
    prisma.fuelIssue.count({ where }),
    prisma.fuelIssue.findMany({
      where,
      skip,
      take,
      omit: { photoData: true },
      orderBy: { issueDate: "desc" },
      include: {
        issuedBy: { select: { id: true, name: true, username: true } },
        bulkTank: { select: { id: true, name: true } },
      },
    }),
  ]);

  return ok(issues, paginationMeta(total, page, perPage));
}
