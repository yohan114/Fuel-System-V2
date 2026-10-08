import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { updateServiceRecordSchema } from "@/lib/api/schemas";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const service = await prisma.serviceRecord.findUnique({
    where: { id },
    include: {
      asset: {
        include: {
          category: true,
          project: true,
        },
      },
      recordedBy: {
        select: { id: true, name: true, username: true },
      },
      attachments: true,
    },
  });

  if (!service) {
    return err("NOT_FOUND", `Service record '${id}' not found`, 404);
  }

  return ok(service);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:services");
  if ("error" in authResult) return authResult.error;
  const { auth } = authResult;

  const { id } = await props.params;

  const existing = await prisma.serviceRecord.findUnique({ where: { id } });
  if (!existing) {
    return err("NOT_FOUND", `Service record '${id}' not found`, 404);
  }

  try {
    const body = await req.json();
    const parsed = updateServiceRecordSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid update parameters", 400, parsed.error.format());
    }

    const data: any = { ...parsed.data };
    if (data.serviceDate) data.serviceDate = new Date(data.serviceDate);

    const updated = await prisma.serviceRecord.update({
      where: { id },
      data,
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id || null,
        action: "UPDATE",
        entity: "ServiceRecord",
        entityId: id,
        summary: `Updated service record for ${updated.asset?.code || existing.assetId} via API`,
        metaJson: JSON.stringify(parsed.data),
      },
    });

    return ok(updated);
  } catch (error) {
    console.error("[api/v1/services/[id] PATCH] Error:", error);
    return err("INTERNAL_ERROR", "Failed to update service record", 500);
  }
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:services");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can delete service records", 403);
  }

  const { id } = await props.params;
  const existing = await prisma.serviceRecord.findUnique({ where: { id } });
  if (!existing) {
    return err("NOT_FOUND", `Service record '${id}' not found`, 404);
  }

  await prisma.serviceRecord.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorId: auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id || null,
      action: "DELETE",
      entity: "ServiceRecord",
      entityId: id,
      summary: `Deleted service record ${id} for asset ${existing.assetId} via API`,
    },
  });

  return ok({ message: "Service record deleted successfully", id });
}
