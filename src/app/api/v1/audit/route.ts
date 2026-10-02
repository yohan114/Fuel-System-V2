import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:admin");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const entityId = url.searchParams.get("entityId");
  const action = url.searchParams.get("action");
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.AuditLogWhereInput = {};
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (fromStr || toStr) {
    where.createdAt = {};
    if (fromStr) where.createdAt.gte = new Date(fromStr);
    if (toStr) where.createdAt.lte = new Date(toStr);
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, name: true, username: true, role: true } },
      },
    }),
  ]);

  return ok(logs, paginationMeta(total, page, perPage));
}
