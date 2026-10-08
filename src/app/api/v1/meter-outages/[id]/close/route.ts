import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { closeMeterOutageSchema } from "@/lib/api/schemas";
import { colomboDayKey, colomboDayStart } from "@/lib/colombo-date";
import { isSiteUser } from "@/lib/roles";
import { canUserAccessAsset } from "@/lib/assignments";

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return handleClose(req, props);
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return handleClose(req, props);
}

async function handleClose(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:meter-outages");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const { id } = await props.params;

  const outage = await prisma.meterOutage.findUnique({
    where: { id },
    include: { asset: true },
  });

  if (!outage) {
    return err("NOT_FOUND", `Meter outage '${id}' not found`, 404);
  }

  if (outage.endDate !== null) {
    return err("BAD_REQUEST", `Meter outage '${id}' has already been closed`, 400);
  }

  try {
    const body = await req.json();
    const parsed = closeMeterOutageSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid close parameters", 400, parsed.error.format());
    }

    const { endDate: endDateStr, resolution, resumeReading, resolutionNotes } = parsed.data;

    const endDate = endDateStr
      ? colomboDayStart(colomboDayKey(endDateStr))
      : colomboDayStart(colomboDayKey(new Date()));

    if (endDate < outage.startDate) {
      return err("VALIDATION_ERROR", "End date cannot be earlier than start date", 400);
    }

    // Site-scoped users may only close outages for assets allocated to their site (Master Plan SEC-02)
    if (auth.user && isSiteUser(auth.role) && auth.user.projectId) {
      const allowed = await canUserAccessAsset(auth.user, outage.asset.id, endDate);
      if (!allowed) {
        return err("FORBIDDEN", "This vehicle is not allocated to your site", 403);
      }
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to close meter outage", 403);
    }

    const source = resolution === "replaced" ? "INSTRUMENT_RESET" : "REPAIR_RESUME";

    const result = await prisma.$transaction(async (tx) => {
      const updatedOutage = await tx.meterOutage.update({
        where: { id: outage.id },
        data: {
          endDate,
          endPhysicalMeter: resumeReading,
          instrumentContinuity: resolution,
          closedById: actorId,
          closeNote: resolutionNotes || null,
        },
        include: {
          asset: {
            select: { id: true, code: true, regNo: true, meterType: true },
          },
          openedBy: { select: { id: true, name: true, username: true } },
          closedBy: { select: { id: true, name: true, username: true } },
        },
      });

      const reading = await tx.meterReading.create({
        data: {
          assetId: outage.assetId,
          value: resumeReading,
          readingType: outage.asset.meterType,
          readingDate: endDate,
          source,
          recordedById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE",
          entity: "MeterOutage",
          entityId: outage.id,
          summary: `Closed meter outage for ${outage.asset.code} (${resolution}) via API on ${colomboDayKey(
            endDate
          )} at reading ${resumeReading}`,
        },
      });

      return { outage: updatedOutage, reading };
    });

    return ok(result);
  } catch (error) {
    console.error("[api/v1/meter-outages/[id]/close PATCH] Error:", error);
    return err("INTERNAL_ERROR", "Failed to close meter outage", 500);
  }
}
