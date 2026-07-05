"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

// Log a completed service. The countdown to the next service resets at this
// record's date (and meterAtService when supplied — compute.ts reads it
// directly, so no MeterReading is written and billing meter deltas are
// untouched).
export async function logServiceAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to log services" };
  }

  const assetRef = formData.get("assetId")?.toString().trim();
  const serviceDateStr = formData.get("serviceDate")?.toString();
  const meterStr = formData.get("meterAtService")?.toString().trim();
  const serviceType = formData.get("serviceType")?.toString().trim() || null;
  const costStr = formData.get("costLkr")?.toString().trim();
  const note = formData.get("note")?.toString().trim() || null;
  const jobNo = formData.get("jobNo")?.toString().trim() || null;

  if (!assetRef || !serviceDateStr) {
    return { error: "Asset and service date are required" };
  }

  const serviceDate = new Date(serviceDateStr);
  if (isNaN(serviceDate.getTime())) return { error: "Invalid service date" };

  const meterAtService = meterStr ? parseFloat(meterStr) : null;
  if (meterAtService != null && (isNaN(meterAtService) || meterAtService < 0)) {
    return { error: "Meter at service must be zero or greater" };
  }
  const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
  if (costCents != null && (isNaN(costCents) || costCents < 0)) return { error: "Cost must be zero or greater" };

  try {
    const asset = await prisma.asset.findFirst({
      where: { OR: [{ id: assetRef }, { code: assetRef.toUpperCase() }] },
      select: { id: true, code: true, meterType: true },
    });
    if (!asset) return { error: "Vehicle not found" };

    const rec = await prisma.serviceRecord.create({
      data: {
        assetId: asset.id,
        serviceDate,
        meterAtService,
        meterType: asset.meterType,
        serviceType,
        costCents,
        note,
        jobNo,
        recordedById: admin.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "ServiceRecord",
        entityId: rec.id,
        summary: `Logged service for ${asset.code} on ${serviceDate.toLocaleDateString("en-GB")}${meterAtService != null ? ` @ ${meterAtService} ${asset.meterType}` : ""}${serviceType ? ` (${serviceType})` : ""}`,
      },
    });

    revalidatePath("/service");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Log service error:", err);
    return { error: err.message || "Failed to log service" };
  }
}

// Add a task to a category's PM plan (shared by every vehicle of the category).
export async function addPMTaskAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit PM plans" };
  }

  const categoryId = formData.get("categoryId")?.toString();
  const assetCode = formData.get("assetCode")?.toString() || "";
  const intervalHours = parseFloat(formData.get("intervalHours")?.toString() || "");
  const description = formData.get("description")?.toString().trim();
  const system = formData.get("system")?.toString().trim() || null;
  const component = formData.get("component")?.toString().trim() || null;
  const parts = formData.get("parts")?.toString().trim() || null;

  if (!categoryId || !description) return { error: "Category and task description are required" };
  if (isNaN(intervalHours) || intervalHours <= 0) return { error: "Interval is required" };

  try {
    const sibling = await prisma.pMTask.findFirst({
      where: { categoryId, intervalHours },
      select: { intervalLabel: true },
    });
    const last = await prisma.pMTask.findFirst({
      where: { categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const task = await prisma.pMTask.create({
      data: {
        categoryId,
        intervalHours,
        intervalLabel: sibling?.intervalLabel ?? `Every ${intervalHours} h`,
        system,
        component,
        description,
        parts,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "PMTask",
        entityId: task.id,
        summary: `Added PM task "${description}" (${task.intervalLabel}) to category plan`,
      },
    });
    if (assetCode) revalidatePath(`/service/plan/${assetCode}`);
    return { success: true };
  } catch (err: any) {
    console.error("Add PM task error:", err);
    return { error: err.message || "Failed to add PM task" };
  }
}

// Remove a task from a category's PM plan.
export async function deletePMTaskAction(taskId: string, assetCode: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit PM plans" };
  }
  try {
    const task = await prisma.pMTask.delete({ where: { id: taskId } });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "DELETE",
        entity: "PMTask",
        entityId: taskId,
        summary: `Removed PM task "${task.description}" (${task.intervalLabel}) from category plan`,
      },
    });
    if (assetCode) revalidatePath(`/service/plan/${assetCode}`);
    return { success: true };
  } catch (err: any) {
    console.error("Delete PM task error:", err);
    return { error: err.message || "Failed to delete PM task" };
  }
}

// Upsert a service interval — a per-category default or a per-asset override.
export async function setServiceIntervalAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to set service intervals" };
  }

  const scope = formData.get("scope")?.toString(); // "category" | "asset"
  const categoryId = formData.get("categoryId")?.toString() || null;
  const assetId = formData.get("assetId")?.toString() || null;
  const basisRaw = formData.get("basis")?.toString().toUpperCase();
  const valueStr = formData.get("intervalValue")?.toString().trim();
  const monthsStr = formData.get("intervalMonths")?.toString().trim();

  const basis = basisRaw === "KM" ? "KM" : basisRaw === "HOURS" ? "HOURS" : null;
  const intervalValue = valueStr ? parseFloat(valueStr) : NaN;
  const intervalMonths = monthsStr ? parseInt(monthsStr, 10) : null;

  if (!basis) return { error: "Basis must be HOURS or KM" };
  if (isNaN(intervalValue) || intervalValue <= 0) return { error: "Interval must be greater than zero" };
  if (intervalMonths != null && (isNaN(intervalMonths) || intervalMonths < 0)) return { error: "Months must be zero or greater" };

  try {
    let revalidateCode: string | null = null;
    if (scope === "asset" && assetId) {
      await prisma.serviceInterval.upsert({
        where: { assetId },
        update: { basis, intervalValue, intervalMonths },
        create: { assetId, basis, intervalValue, intervalMonths },
      });
      const a = await prisma.asset.findUnique({ where: { id: assetId }, select: { code: true } });
      revalidateCode = a?.code ?? null;
    } else if (scope === "category" && categoryId) {
      await prisma.serviceInterval.upsert({
        where: { categoryId },
        update: { basis, intervalValue, intervalMonths },
        create: { categoryId, basis, intervalValue, intervalMonths },
      });
    } else {
      return { error: "Provide a category or asset to configure" };
    }

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "ServiceInterval",
        summary: `Set ${scope} service interval: ${intervalValue} ${basis}${intervalMonths ? ` / ${intervalMonths}mo` : ""}`,
      },
    });

    revalidatePath("/service");
    if (revalidateCode) revalidatePath(`/fleet/${revalidateCode}`);
    return { success: true };
  } catch (err: any) {
    console.error("Set service interval error:", err);
    return { error: err.message || "Failed to set service interval" };
  }
}
