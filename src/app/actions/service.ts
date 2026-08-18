"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { computeServiceCost, lineAmountCents, type CostItem } from "@/lib/service/cost";
import { getServiceConfig } from "@/lib/service/config";
import { errorMessage } from "@/lib/errors";

interface SheetLine {
  slot?: string;
  label?: string;
  partNo?: string;
  action?: string;
  qty?: number;
  unitPriceCents?: number;
}

function parseLines(raw: FormDataEntryValue | null): SheetLine[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw.toString());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Log a full service sheet: header + itemised oil / filter / manpower lines +
// scanned attachments, with parts / labour / sundry / total costed from the
// lines. Mirrors the paper "Vehicle/Machinery Service Details" form.
export async function logServiceSheetAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to log services" };
  }

  const assetRef = formData.get("assetId")?.toString().trim();
  const serviceDateStr = formData.get("serviceDate")?.toString();
  if (!assetRef || !serviceDateStr) return { error: "Vehicle and service date are required" };
  const serviceDate = new Date(serviceDateStr);
  if (isNaN(serviceDate.getTime())) return { error: "Invalid service date" };

  const meterStr = formData.get("meterAtService")?.toString().trim();
  const nextStr = formData.get("nextServiceMeter")?.toString().trim();
  const meterAtService = meterStr ? parseFloat(meterStr) : null;
  const nextServiceMeter = nextStr ? parseFloat(nextStr) : null;
  if (meterAtService != null && (isNaN(meterAtService) || meterAtService < 0)) return { error: "Meter must be zero or greater" };

  const serviceType = formData.get("serviceType")?.toString().trim() || null;
  const jobNo = formData.get("jobNo")?.toString().trim() || null;
  const location = formData.get("location")?.toString().trim() || null;
  const condition = formData.get("condition")?.toString().trim() || null;
  const note = formData.get("note")?.toString().trim() || null;

  const oilLines = parseLines(formData.get("oilLines"));
  const filterLines = parseLines(formData.get("filterLines"));
  const manpowerLines = parseLines(formData.get("manpowerLines"));

  try {
    const asset = await prisma.asset.findFirst({
      where: { OR: [{ id: assetRef }, { code: assetRef.toUpperCase() }] },
      select: { id: true, code: true, meterType: true },
    });
    if (!asset) return { error: "Vehicle not found" };

    // Build the persisted line items with server-computed amounts.
    const items: { kind: string; description: string; partNo: string | null; action: string | null; qty: number; unitPriceCents: number | null; amountCents: number | null }[] = [];
    const costItems: CostItem[] = [];

    for (const l of oilLines) {
      const qty = Number(l.qty) || 0;
      const unit = l.unitPriceCents != null ? Math.round(Number(l.unitPriceCents)) : null;
      // Chart rows always carry a slot — a row is real only once a grade, an
      // action (C/V) or a quantity was entered on it.
      if (!l.label && !l.action && qty === 0) continue;
      const amount = lineAmountCents(qty, unit);
      items.push({ kind: "OIL", description: [l.slot, l.label].filter(Boolean).join(" — ") || "Oil", partNo: l.label || null, action: l.action || null, qty, unitPriceCents: unit, amountCents: amount });
      costItems.push({ kind: "OIL", amountCents: amount });
    }
    for (const l of filterLines) {
      const qty = Number(l.qty) || 1;
      const unit = l.unitPriceCents != null ? Math.round(Number(l.unitPriceCents)) : null;
      // Real once a part number, an action (X/E) or a price was entered — a
      // cleaned filter (E) with no part no is still a recorded event.
      if (!l.partNo && !l.action && !(unit && unit > 0)) continue;
      const amount = lineAmountCents(qty, unit);
      items.push({ kind: "FILTER", description: l.slot || "Filter", partNo: l.partNo || null, action: l.action || null, qty, unitPriceCents: unit, amountCents: amount });
      costItems.push({ kind: "FILTER", amountCents: amount });
    }
    for (const l of manpowerLines) {
      const qty = Number(l.qty) || 1;
      const unit = l.unitPriceCents != null ? Math.round(Number(l.unitPriceCents)) : null;
      if (!l.label && (unit == null || unit === 0)) continue;
      const amount = lineAmountCents(qty, unit);
      items.push({ kind: "MANPOWER", description: l.label || "Labour / other", partNo: null, action: null, qty, unitPriceCents: unit, amountCents: amount });
      costItems.push({ kind: "MANPOWER", amountCents: amount });
    }

    const cfg = await getServiceConfig();
    const cost = computeServiceCost(costItems, { labourPct: cfg.labourPct, sundryPct: cfg.sundryPct });

    // Read attachments before the transaction (File → Buffer).
    const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
    const attachments = await Promise.all(
      files.map(async (f) => ({
        fileName: f.name || "attachment",
        mimeType: f.type || "application/octet-stream",
        data: Buffer.from(await f.arrayBuffer()),
        uploadedById: admin.id,
      })),
    );

    const rec = await prisma.serviceRecord.create({
      data: {
        assetId: asset.id,
        serviceDate,
        meterAtService,
        meterType: asset.meterType,
        serviceType,
        jobNo,
        location,
        nextServiceMeter,
        condition,
        note,
        partsCents: cost.partsCents,
        manpowerCents: cost.manpowerCents,
        labourCents: cost.labourCents,
        sundryCents: cost.sundryCents,
        costCents: cost.totalCents,
        recordedById: admin.id,
        items: { create: items },
        attachments: attachments.length ? { create: attachments } : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "ServiceRecord", entityId: rec.id,
        summary: `Logged service sheet for ${asset.code} on ${serviceDate.toLocaleDateString("en-GB")}${meterAtService != null ? ` @ ${meterAtService} ${asset.meterType}` : ""} — total Rs. ${(cost.totalCents / 100).toLocaleString("en-LK")} (${items.length} lines, ${attachments.length} file(s))`,
      },
    });

    revalidatePath("/service");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true, id: rec.id };
  } catch (err: unknown) {
    console.error("Log service sheet error:", err);
    return { error: errorMessage(err) || "Failed to log service" };
  }
}

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
  } catch (err: unknown) {
    console.error("Log service error:", err);
    return { error: errorMessage(err) || "Failed to log service" };
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
  } catch (err: unknown) {
    console.error("Add PM task error:", err);
    return { error: errorMessage(err) || "Failed to add PM task" };
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
  } catch (err: unknown) {
    console.error("Delete PM task error:", err);
    return { error: errorMessage(err) || "Failed to delete PM task" };
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
  } catch (err: unknown) {
    console.error("Set service interval error:", err);
    return { error: errorMessage(err) || "Failed to set service interval" };
  }
}
