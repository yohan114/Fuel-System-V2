"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

// Parses an "YYYY-MM-DD" form value into a Colombo local-midnight Date, matching
// the day-granular convention used by billing/periods/assignments. Returns null
// for empty/invalid input.
function parseLocalDate(value: FormDataEntryValue | null): Date | null {
  const s = value?.toString().trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Re-points the legacy Asset.projectId "current site" pointer at whichever
// assignment is active today (or, failing that, the most recently started one),
// so the fleet list and any remaining projectId-based views stay accurate.
async function syncAssetCurrentProject(assetId: string) {
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const active = await prisma.assetAssignment.findFirst({
    where: {
      assetId,
      startDate: { lte: todayMid },
      OR: [{ endDate: null }, { endDate: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()) } }],
    },
    orderBy: { startDate: "desc" },
  });

  const fallback = active
    ? null
    : await prisma.assetAssignment.findFirst({ where: { assetId }, orderBy: { startDate: "desc" } });

  const target = active ?? fallback;
  await prisma.asset.update({
    where: { id: assetId },
    data: { projectId: target ? target.projectId : null },
  });
}

// Posts a vehicle to a site for a date range. If the vehicle currently has an
// open (no end date) posting that began on/before the new start, that posting is
// automatically closed the day before the new start — so "move HEX-23 to site Y
// from Monday" is a single action.
export async function createAssignmentAction(formData: FormData) {
  let actor;
  try {
    actor = await assertCan("allocate");
  } catch {
    return { error: "You are not authorized to assign vehicles to sites" };
  }

  const assetId = formData.get("assetId")?.toString();
  const projectId = formData.get("projectId")?.toString();
  const startDate = parseLocalDate(formData.get("startDate"));
  const endDate = parseLocalDate(formData.get("endDate"));
  const note = formData.get("note")?.toString().trim() || null;

  if (!assetId || !projectId || !startDate) {
    return { error: "Vehicle, site and start date are required" };
  }
  if (endDate && endDate < startDate) {
    return { error: "End date cannot be before the start date" };
  }

  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { error: "Vehicle not found" };
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return { error: "Site not found" };

    // Close any open posting that started on/before the new start date.
    const dayBefore = new Date(startDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const openPriors = await prisma.assetAssignment.findMany({
      where: { assetId, endDate: null, startDate: { lte: startDate } },
    });
    for (const prior of openPriors) {
      // Only close it if it actually started before the new posting.
      if (prior.startDate <= dayBefore) {
        await prisma.assetAssignment.update({
          where: { id: prior.id },
          data: { endDate: dayBefore },
        });
      }
    }

    await prisma.assetAssignment.create({
      data: { assetId, projectId, startDate, endDate, note, createdById: actor.id },
    });

    await syncAssetCurrentProject(assetId);

    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "CREATE",
        entity: "AssetAssignment",
        entityId: assetId,
        summary: `Assigned ${asset.code} to ${project.code} from ${fmt(startDate)}${endDate ? ` to ${fmt(endDate)}` : " (ongoing)"}`,
      },
    });

    revalidatePath("/admin/assignments");
    revalidatePath("/allocator");
    revalidatePath("/fleet");
    revalidatePath("/readings");
    revalidatePath("/");
    return { success: true };
  } catch (err: any) {
    console.error("Create assignment error:", err);
    return { error: err.message || "Failed to assign vehicle" };
  }
}

// Closes an open posting (or changes an existing end date).
export async function endAssignmentAction(assignmentId: string, endDateStr: string) {
  let actor;
  try {
    actor = await assertCan("allocate");
  } catch {
    return { error: "You are not authorized to update assignments" };
  }

  const endDate = parseLocalDate(endDateStr);
  if (!endDate) return { error: "A valid end date is required" };

  try {
    const assignment = await prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
      include: { asset: true, project: true },
    });
    if (!assignment) return { error: "Assignment not found" };
    if (endDate < assignment.startDate) {
      return { error: "End date cannot be before the start date" };
    }

    await prisma.assetAssignment.update({ where: { id: assignmentId }, data: { endDate } });
    await syncAssetCurrentProject(assignment.assetId);

    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "UPDATE",
        entity: "AssetAssignment",
        entityId: assignment.assetId,
        summary: `Ended ${assignment.asset.code} @ ${assignment.project.code} on ${fmt(endDate)}`,
      },
    });

    revalidatePath("/admin/assignments");
    revalidatePath("/fleet");
    revalidatePath("/");
    return { success: true };
  } catch (err: any) {
    console.error("End assignment error:", err);
    return { error: err.message || "Failed to update assignment" };
  }
}

// Removes an assignment row entirely (correcting a mistake).
export async function deleteAssignmentAction(assignmentId: string) {
  let actor;
  try {
    actor = await assertCan("allocate");
  } catch {
    return { error: "You are not authorized to delete assignments" };
  }

  try {
    const assignment = await prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
      include: { asset: true, project: true },
    });
    if (!assignment) return { error: "Assignment not found" };

    await prisma.assetAssignment.delete({ where: { id: assignmentId } });
    await syncAssetCurrentProject(assignment.assetId);

    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "DELETE",
        entity: "AssetAssignment",
        entityId: assignment.assetId,
        summary: `Removed ${assignment.asset.code} @ ${assignment.project.code} assignment (${fmt(assignment.startDate)})`,
      },
    });

    revalidatePath("/admin/assignments");
    revalidatePath("/fleet");
    revalidatePath("/");
    return { success: true };
  } catch (err: any) {
    console.error("Delete assignment error:", err);
    return { error: err.message || "Failed to delete assignment" };
  }
}
