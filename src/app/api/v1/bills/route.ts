import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { currentMonthPeriod } from "@/lib/billing/period";
import { billingScope } from "@/lib/roles";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || currentMonthPeriod().periodKey;
  let projectId = url.searchParams.get("projectId") || "";
  const status = url.searchParams.get("status") || "";

  // Enforce billing allow-list scoping (Master Plan SEC-02)
  if (auth.user) {
    const scope = billingScope(auth.user);
    if (scope.kind === "none") {
      return err("FORBIDDEN", "You do not have access to billing records", 403);
    }
    if (scope.kind === "project") {
      projectId = scope.projectId;
    }
  }

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.BillWhereInput = { periodKey: ym };
  if (projectId) where.projectId = projectId;
  if (status) where.status = status;

  const [total, bills] = await Promise.all([
    prisma.bill.count({ where }),
    prisma.bill.findMany({
      where,
      skip,
      take,
      orderBy: { grandTotalCents: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
      },
    }),
  ]);

  return ok(bills, paginationMeta(total, page, perPage));
}
