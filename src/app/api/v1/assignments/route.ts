import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const createAssignmentSchema = z.object({
  assetId: z.string().min(1),
  projectId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") || "";
  const projectId = url.searchParams.get("projectId") || "";
  const activeOnly = url.searchParams.get("activeOnly") === "true";

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.AssetAssignmentWhereInput = {};
  if (assetId) where.assetId = assetId;
  if (projectId) where.projectId = projectId;
  if (activeOnly) where.endDate = null;

  const [total, assignments] = await Promise.all([
    prisma.assetAssignment.count({ where }),
    prisma.assetAssignment.findMany({
      where,
      skip,
      take,
      orderBy: { startDate: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
        project: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(assignments, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:assignments");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN" && auth.role !== "ALLOCATOR") {
    return err("FORBIDDEN", "Only administrators or allocators can assign vehicles", 403);
  }

  try {
    const body = await req.json();
    const parsed = createAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid assignment parameters", 400, parsed.error.format());
    }

    const { assetId, projectId, startDate, endDate, notes } = parsed.data;

    const assignment = await prisma.assetAssignment.create({
      data: {
        assetId,
        projectId,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        note: notes ?? null,
        createdById: auth.user?.id ?? null,
      },
      include: {
        asset: { select: { id: true, code: true } },
        project: { select: { id: true, name: true, code: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.user?.id ?? null,
        action: "CREATE",
        entity: "AssetAssignment",
        entityId: assignment.id,
        summary: `Created assignment for ${assignment.asset.code} to ${assignment.project.name} via API`,
        metaJson: JSON.stringify({ assetId, projectId, startDate, endDate }),
      },
    });

    return ok(assignment, undefined, 201);
  } catch (error) {
    console.error("[api/v1/assignments POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create assignment", 500);
  }
}
