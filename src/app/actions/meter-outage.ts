"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { colomboDayKey, colomboDayStart } from "@/lib/colombo-date";

export async function openMeterOutageAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const assetIdRaw = formData.get("assetId")?.toString().trim();
  const startDateStr = formData.get("startDate")?.toString().trim();
  const reason = formData.get("reason")?.toString().trim() || null;

  if (!assetIdRaw || !startDateStr) {
    return { error: "Asset and start date are required" };
  }

  try {
    const asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { id: assetIdRaw },
          { code: assetIdRaw.toUpperCase() },
          { regNo: assetIdRaw.toUpperCase() },
        ],
      },
    });

    if (!asset) {
      return { error: `Asset '${assetIdRaw}' not found` };
    }

    // Check if asset already has an open outage
    const existing = await prisma.meterOutage.findFirst({
      where: {
        assetId: asset.id,
        endDate: null,
      },
    });

    if (existing) {
      return {
        error: `Asset ${asset.code} already has an active meter outage opened on ${colomboDayKey(existing.startDate)}. Close it before opening a new one.`,
      };
    }

    const startDate = colomboDayStart(colomboDayKey(startDateStr));

    const outage = await prisma.$transaction(async (tx) => {
      const created = await tx.meterOutage.create({
        data: {
          assetId: asset.id,
          startDate,
          openedById: user.id,
          reason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entity: "MeterOutage",
          entityId: created.id,
          summary: `Opened meter outage for ${asset.code} from ${colomboDayKey(startDate)}${reason ? `: ${reason}` : ""}`,
        },
      });

      return created;
    });

    revalidatePath("/readings");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/admin/meter-outages");
    revalidatePath("/service/planner");

    return { success: true, outageId: outage.id };
  } catch (err: unknown) {
    console.error("Open meter outage error:", err);
    return { error: errorMessage(err) || "Failed to open meter outage" };
  }
}

export async function closeMeterOutageAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const outageId = formData.get("outageId")?.toString().trim();
  const endDateStr = formData.get("endDate")?.toString().trim();
  const meterValStr = formData.get("endPhysicalMeter")?.toString().trim();
  const instrumentContinuity = formData.get("instrumentContinuity")?.toString().trim();
  const closeNote = formData.get("closeNote")?.toString().trim() || null;

  if (!outageId || !endDateStr || !instrumentContinuity) {
    return { error: "Outage ID, end date, and instrument continuity (repaired / replaced) are required" };
  }

  if (instrumentContinuity !== "repaired" && instrumentContinuity !== "replaced") {
    return { error: "Instrument continuity must be either 'repaired' or 'replaced'" };
  }

  const endPhysicalMeter = meterValStr && meterValStr !== "" ? parseFloat(meterValStr) : null;
  if (endPhysicalMeter !== null && (isNaN(endPhysicalMeter) || endPhysicalMeter < 0)) {
    return { error: "Please enter a valid non-negative physical meter reading" };
  }

  try {
    const outage = await prisma.meterOutage.findUnique({
      where: { id: outageId },
      include: { asset: true },
    });

    if (!outage) {
      return { error: "Meter outage not found" };
    }

    if (outage.endDate !== null) {
      return { error: "This meter outage has already been closed" };
    }

    const endDate = colomboDayStart(colomboDayKey(endDateStr));
    if (endDate < outage.startDate) {
      return { error: "End date cannot be earlier than start date" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.meterOutage.update({
        where: { id: outage.id },
        data: {
          endDate,
          endPhysicalMeter,
          instrumentContinuity,
          closedById: user.id,
          closeNote,
        },
      });

      // Write closing meter reading if value supplied
      if (endPhysicalMeter !== null) {
        const source = instrumentContinuity === "replaced" ? "INSTRUMENT_RESET" : "REPAIR_RESUME";
        await tx.meterReading.create({
          data: {
            assetId: outage.assetId,
            value: endPhysicalMeter,
            readingType: outage.asset.meterType,
            readingDate: endDate,
            source,
            recordedById: user.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entity: "MeterOutage",
          entityId: outage.id,
          summary: `Closed meter outage for ${outage.asset.code} (${instrumentContinuity}) on ${colomboDayKey(endDate)}${
            endPhysicalMeter !== null ? ` at reading ${endPhysicalMeter}` : ""
          }${closeNote ? `: ${closeNote}` : ""}`,
        },
      });
    });

    revalidatePath("/readings");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${outage.asset.code}`);
    revalidatePath("/admin/meter-outages");
    revalidatePath("/service/planner");

    return { success: true };
  } catch (err: unknown) {
    console.error("Close meter outage error:", err);
    return { error: errorMessage(err) || "Failed to close meter outage" };
  }
}

export async function cancelMeterOutageAction(formData: FormData | string) {
  let user;
  try {
    user = await assertCan("delete");
  } catch (err) {
    return { error: "You are not authorized to cancel meter outages (Admin required)" };
  }

  const outageId = typeof formData === "string" ? formData : formData.get("outageId")?.toString().trim();
  if (!outageId) {
    return { error: "Outage ID is required" };
  }

  try {
    const outage = await prisma.meterOutage.findUnique({
      where: { id: outageId },
      include: { asset: true },
    });

    if (!outage) {
      return { error: "Meter outage not found" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.meterOutage.delete({
        where: { id: outage.id },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "DELETE",
          entity: "MeterOutage",
          entityId: outage.id,
          summary: `Cancelled meter outage for ${outage.asset.code} (was from ${colomboDayKey(outage.startDate)})`,
        },
      });
    });

    revalidatePath("/readings");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${outage.asset.code}`);
    revalidatePath("/admin/meter-outages");
    revalidatePath("/service/planner");

    return { success: true };
  } catch (err: unknown) {
    console.error("Cancel meter outage error:", err);
    return { error: errorMessage(err) || "Failed to cancel meter outage" };
  }
}

export async function editMeterOutageAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("update");
  } catch (err) {
    return { error: "You are not authorized to edit meter outages" };
  }

  const outageId = formData.get("outageId")?.toString().trim();
  const startDateStr = formData.get("startDate")?.toString().trim();
  const endDateStr = formData.get("endDate")?.toString().trim();
  const reason = formData.get("reason")?.toString().trim();
  const continuity = formData.get("instrumentContinuity")?.toString().trim();
  const meterValStr = formData.get("endPhysicalMeter")?.toString().trim();
  const closeNote = formData.get("closeNote")?.toString().trim();

  if (!outageId) {
    return { error: "Outage ID is required" };
  }

  try {
    const outage = await prisma.meterOutage.findUnique({
      where: { id: outageId },
      include: { asset: true },
    });

    if (!outage) {
      return { error: "Meter outage not found" };
    }

    const startDate = startDateStr ? colomboDayStart(colomboDayKey(startDateStr)) : outage.startDate;
    const endDate = endDateStr && endDateStr !== "" ? colomboDayStart(colomboDayKey(endDateStr)) : null;
    const endPhysicalMeter = meterValStr && meterValStr !== "" ? parseFloat(meterValStr) : null;
    const instrumentContinuity = continuity && continuity !== "" ? continuity : null;

    if (endDate && endDate < startDate) {
      return { error: "End date cannot be earlier than start date" };
    }

    if (instrumentContinuity && instrumentContinuity !== "repaired" && instrumentContinuity !== "replaced") {
      return { error: "Instrument continuity must be 'repaired' or 'replaced'" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.meterOutage.update({
        where: { id: outage.id },
        data: {
          startDate,
          endDate,
          reason: reason !== undefined ? reason : outage.reason,
          endPhysicalMeter: endPhysicalMeter !== null ? endPhysicalMeter : outage.endPhysicalMeter,
          instrumentContinuity: instrumentContinuity !== null ? instrumentContinuity : outage.instrumentContinuity,
          closeNote: closeNote !== undefined ? closeNote : outage.closeNote,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entity: "MeterOutage",
          entityId: outage.id,
          summary: `Updated meter outage for ${outage.asset.code}`,
        },
      });
    });

    revalidatePath("/readings");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${outage.asset.code}`);
    revalidatePath("/admin/meter-outages");
    revalidatePath("/service/planner");

    return { success: true };
  } catch (err: unknown) {
    console.error("Edit meter outage error:", err);
    return { error: errorMessage(err) || "Failed to edit meter outage" };
  }
}
