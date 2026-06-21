"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { computeServiceTotals, getServiceRates } from "@/lib/service/charge";

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

// ---------------------------------------------------------------------------
// Detailed service sheet (merged from the standalone Service Record system).
// Captures the full oils / filters / cost-lines breakdown and computes the
// labour + sundry totals server-side. Writes a single ServiceRecord (with its
// children) — the same table the Service Planner reads, so logging a detailed
// service immediately resets that asset's "last service / next due".
// ---------------------------------------------------------------------------

export interface DetailedOilInput {
  name: string;
  type?: string;
  action?: string;
  quantity?: number;
  priceLkr?: number;
}
export interface DetailedFilterInput {
  category: string;
  no?: string;
  action?: string;
  quantity?: number;
  priceLkr?: number;
}
export interface DetailedCostInput {
  description?: string;
  unit?: string;
  rateLkr?: number;
  qty?: number;
  amountLkr?: number;
}
export interface DetailedServiceInput {
  assetRef: string; // asset id or E&C code
  serviceDate: string; // yyyy-mm-dd
  jobNo?: string;
  meterAtService?: number | null;
  nextServiceMeter?: number | null;
  serviceType?: string;
  siteLocation?: string;
  upkeepingStatus?: string;
  repairDetails?: string;
  note?: string;
  oils?: DetailedOilInput[];
  filters?: DetailedFilterInput[];
  costs?: DetailedCostInput[];
}

function lkrToCents(lkr: number | null | undefined): number {
  const n = Number(lkr);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export async function logDetailedServiceAction(input: DetailedServiceInput) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to log services" };
  }

  if (!input?.assetRef || !input?.serviceDate) {
    return { error: "Vehicle and service date are required" };
  }

  const serviceDate = new Date(input.serviceDate);
  if (isNaN(serviceDate.getTime())) return { error: "Invalid service date" };

  const meterAtService =
    input.meterAtService != null && Number.isFinite(Number(input.meterAtService)) ? Number(input.meterAtService) : null;
  if (meterAtService != null && meterAtService < 0) return { error: "Meter at service must be zero or greater" };
  const nextServiceMeter =
    input.nextServiceMeter != null && Number.isFinite(Number(input.nextServiceMeter)) ? Number(input.nextServiceMeter) : null;

  try {
    const asset = await prisma.asset.findFirst({
      where: { OR: [{ id: input.assetRef }, { code: input.assetRef.toUpperCase() }] },
      select: { id: true, code: true, meterType: true },
    });
    if (!asset) return { error: "Vehicle not found" };

    // Keep only meaningful child rows; all money normalised to LKR cents.
    const oils = (input.oils || [])
      .map((o) => ({
        oilName: (o.name || "").trim(),
        oilType: (o.type || "").trim() || null,
        actionType: (o.action || "").trim() || null,
        quantity: Number(o.quantity) || 0,
        priceCents: lkrToCents(o.priceLkr),
      }))
      .filter((o) => o.oilName && (o.oilType || o.actionType || o.quantity > 0 || o.priceCents > 0));

    const filters = (input.filters || [])
      .map((f) => ({
        filterCategory: (f.category || "").trim(),
        filterNo: (f.no || "").trim() || null,
        actionType: (f.action || "").trim() || null,
        quantity: Number.isFinite(Number(f.quantity)) ? Math.max(1, Math.round(Number(f.quantity))) : 1,
        priceCents: lkrToCents(f.priceLkr),
      }))
      .filter((f) => f.filterCategory && (f.filterNo || f.actionType || f.priceCents > 0));

    const costLines = (input.costs || [])
      .map((c) => {
        const rateCents = lkrToCents(c.rateLkr);
        const qty = Number(c.qty) || 0;
        const amountCents =
          c.amountLkr != null && Number(c.amountLkr) ? lkrToCents(c.amountLkr) : Math.round(rateCents * qty);
        return {
          description: (c.description || "").trim() || null,
          unit: (c.unit || "").trim() || null,
          rateCents,
          qty,
          amountCents,
        };
      })
      .filter((c) => c.description || c.amountCents > 0);

    // Totals are recomputed server-side — never trust client math.
    const partsSubtotalCents =
      oils.reduce((s, o) => s + o.priceCents, 0) +
      filters.reduce((s, f) => s + f.priceCents, 0) +
      costLines.reduce((s, c) => s + c.amountCents, 0);

    const rates = await getServiceRates();
    const totals = computeServiceTotals(partsSubtotalCents, rates);

    const rec = await prisma.serviceRecord.create({
      data: {
        assetId: asset.id,
        serviceDate,
        meterAtService,
        meterType: asset.meterType,
        serviceType: (input.serviceType || "").trim() || null,
        note: (input.note || "").trim() || null,
        jobNo: (input.jobNo || "").trim() || null,
        siteLocation: (input.siteLocation || "").trim() || null,
        nextServiceMeter,
        upkeepingStatus: (input.upkeepingStatus || "").trim() || null,
        repairDetails: (input.repairDetails || "").trim() || null,
        partsSubtotalCents: totals.partsSubtotalCents,
        labourRatePct: totals.labourRatePct,
        labourChargeCents: totals.labourChargeCents,
        sundryRatePct: totals.sundryRatePct,
        sundryAmountCents: totals.sundryAmountCents,
        grandTotalCents: totals.grandTotalCents,
        costCents: totals.grandTotalCents, // mirror so existing displays keep working
        recordedById: admin.id,
        oils: { create: oils },
        filters: { create: filters },
        costLines: { create: costLines },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "ServiceRecord",
        entityId: rec.id,
        summary: `Logged detailed service for ${asset.code} on ${serviceDate.toLocaleDateString("en-GB")}${
          input.jobNo ? ` (Job ${input.jobNo})` : ""
        } — Rs. ${(totals.grandTotalCents / 100).toLocaleString("en-LK")}`,
      },
    });

    revalidatePath("/service");
    revalidatePath("/service/records");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true, id: rec.id };
  } catch (err: any) {
    console.error("Log detailed service error:", err);
    return { error: err.message || "Failed to log service" };
  }
}
