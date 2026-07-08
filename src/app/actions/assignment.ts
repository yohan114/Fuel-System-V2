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

// Normalises a Dry/Wet hire type from the form to the stored "DRY" | "WET"
// value, or null when unset (bill then falls back to the vehicle's rate card).
function parseBillingType(value: FormDataEntryValue | null): string | null {
  const s = value?.toString().trim().toUpperCase();
  if (s === "DRY" || s === "WET") return s;
  return null;
}

// Builds a short, unique, uppercase project code from a free-text site name so a
// non-system site typed by the allocator gets a stable identifier the billing /
// segment / reporting code can group on exactly like a built-in site.
async function uniqueProjectCode(name: string): Promise<string> {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "SITE";
  let code = base;
  for (let i = 2; await prisma.project.findUnique({ where: { code } }); i++) {
    code = `${base}-${i}`;
  }
  return code;
}

// Resolves the target site for an allocation. Either an existing site id is
// given (system site) OR a free-text name is typed for a site that is not in the
// system — in which case the matching project is reused if the name already
// exists, else a new one is created on the fly so it can be billed by hand.
async function resolveTargetProject(
  projectId: string | undefined,
  siteName: string | undefined,
  actorId: string,
): Promise<{ id: string; code: string; name: string } | null> {
  if (projectId) {
    return prisma.project.findUnique({ where: { id: projectId } });
  }
  const name = siteName?.trim();
  if (!name) return null;

  const existing = await prisma.project.findFirst({
    where: { name: { equals: name } },
  });
  if (existing) return existing;

  const code = await uniqueProjectCode(name);
  const created = await prisma.project.create({ data: { name, code } });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "CREATE",
      entity: "Project",
      entityId: created.id,
      summary: `Created non-system site "${name}" (${code}) for a manual allocation`,
    },
  });
  return created;
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
  const siteName = formData.get("siteName")?.toString();
  const startDate = parseLocalDate(formData.get("startDate"));
  const endDate = parseLocalDate(formData.get("endDate"));
  const note = formData.get("note")?.toString().trim() || null;
  const driverName = formData.get("driverName")?.toString().trim() || null;
  const billingType = parseBillingType(formData.get("billingType"));

  if (!assetId || (!projectId && !siteName?.trim()) || !startDate) {
    return { error: "Vehicle, site and start date are required" };
  }
  if (endDate && endDate < startDate) {
    return { error: "End date cannot be before the start date" };
  }

  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { error: "Vehicle not found" };
    const project = await resolveTargetProject(projectId, siteName, actor.id);
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
      data: {
        assetId,
        projectId: project.id,
        startDate,
        endDate,
        note,
        driverName,
        billingType,
        createdById: actor.id,
      },
    });

    await syncAssetCurrentProject(assetId);

    const typeLabel = billingType === "DRY" ? " · Dry" : billingType === "WET" ? " · Wet" : "";
    const driverLabel = driverName ? ` · driver ${driverName}` : "";
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "CREATE",
        entity: "AssetAssignment",
        entityId: assetId,
        summary: `Assigned ${asset.code} to ${project.code} from ${fmt(startDate)}${endDate ? ` to ${fmt(endDate)}` : " (ongoing)"}${typeLabel}${driverLabel}`,
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
