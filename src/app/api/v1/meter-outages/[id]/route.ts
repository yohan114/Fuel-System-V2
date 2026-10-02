import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { editMeterOutageSchema } from "@/lib/api/schemas";
import { colomboDayKey, colomboDayStart } from "@/lib/colombo-date";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:meter-outages");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const outage = await prisma.meterOutage.findUnique({
    where: { id },
    include: {
      asset: {
        select: {
          id: true,
          code: true,
          regNo: true,
          meterType: true,
          project: { select: { id: true, code: true, name: true } },
        },
      },
      openedBy: { select: { id: true, name: true, username: true } },
      closedBy: { select: { id: true, name: true, username: true } },
    },
  });

  if (!outage) {
    return err("NOT_FOUND", `Meter outage '${id}' not found`, 404);
  }

  return ok(outage);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:meter-outages");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can edit meter outages", 403);
  }

  const { id } = await props.params;

  const existing = await prisma.meterOutage.findUnique({
    where: { id },
    include: { asset: true },
  });

  if (!existing) {
    return err("NOT_FOUND", `Meter outage '${id}' not found`, 404);
  }

  try {
    const body = await req.json();
    const parsed = editMeterOutageSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid update parameters", 400, parsed.error.format());
    }

    const { startDate: startDateStr, reason, notes, resolutionNotes } = parsed.data;

    const data: any = {};
    if (startDateStr) {
      data.startDate = colomboDayStart(colomboDayKey(startDateStr));
      if (existing.endDate && data.startDate > existing.endDate) {
        return err("VALIDATION_ERROR", "Start date cannot be after end date", 400);
      }
    }
    if (reason !== undefined) {
      data.reason = notes ? `${reason} (${notes})` : reason;
    } else if (notes !== undefined) {
      data.reason = existing.reason ? `${existing.reason} (${notes})` : notes;
    }
    if (resolutionNotes !== undefined) data.closeNote = resolutionNotes;

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.meterOutage.update({
        where: { id },
        data,
        include: {
          asset: { select: { id: true, code: true, regNo: true, meterType: true } },
          openedBy: { select: { id: true, name: true, username: true } },
          closedBy: { select: { id: true, name: true, username: true } },
        },
      });

      if (actorId) {
        await tx.auditLog.create({
          data: {
            actorId,
            action: "UPDATE",
            entity: "MeterOutage",
            entityId: id,
            summary: `Edited meter outage for ${existing.asset.code} via API`,
          },
        });
      }

      return res;
    });

    return ok(updated);
  } catch (error) {
    console.error("[api/v1/meter-outages/[id] PATCH] Error:", error);
    return err("INTERNAL_ERROR", "Failed to update meter outage", 500);
  }
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:meter-outages");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can cancel meter outages", 403);
  }

  const { id } = await props.params;

  const existing = await prisma.meterOutage.findUnique({
    where: { id },
    include: { asset: true },
  });

  if (!existing) {
    return err("NOT_FOUND", `Meter outage '${id}' not found`, 404);
  }

  const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;

  await prisma.$transaction(async (tx) => {
    await tx.meterOutage.delete({ where: { id } });

    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: "DELETE",
          entity: "MeterOutage",
          entityId: id,
          summary: `Cancelled meter outage for ${existing.asset.code} via API (was from ${colomboDayKey(existing.startDate)})`,
        },
      });
    }
  });

  return ok({ message: "Meter outage cancelled and deleted successfully", id });
}
