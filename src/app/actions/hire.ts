"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

// Hire ("rented-in") fleet management. A HIRED asset is owned by a third party
// and rented in by E&C; these actions capture what E&C pays the owner. They are
// deliberately separate from the RentalRate the company charges sites.

const BASES = new Set(["hour", "day", "month"]);

function rsToCents(raw: string | undefined | null): number | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n) || n < 0) return NaN; // signal invalid
  return Math.round(n * 100);
}

function parseDate(raw: string | undefined | null): Date | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Pull the shared hire fields out of a form. Returns an error string, or the data.
function readHireFields(formData: FormData): { error: string } | {
  hireSupplier: string | null;
  hireRateCents: number | null;
  hireRateBasis: string | null;
  hireStart: Date | null;
  hireEnd: Date | null;
  hireNote: string | null;
  minBillHours: number | null;
} {
  const hireSupplier = formData.get("hireSupplier")?.toString().trim() || null;
  const hireRateCents = rsToCents(formData.get("hireRate")?.toString());
  const basisRaw = formData.get("hireRateBasis")?.toString().trim() || null;
  const hireRateBasis = basisRaw && BASES.has(basisRaw) ? basisRaw : null;
  const hireStart = parseDate(formData.get("hireStart")?.toString());
  const hireEnd = parseDate(formData.get("hireEnd")?.toString());
  const hireNote = formData.get("hireNote")?.toString().trim() || null;

  const minRaw = formData.get("minBillHours")?.toString().trim();
  let minBillHours: number | null = null;
  if (minRaw) {
    const n = parseInt(minRaw, 10);
    if (Number.isNaN(n) || n < 0) return { error: "Minimum working hours must be zero or a positive whole number" };
    minBillHours = n > 0 ? n : null;
  }

  if (Number.isNaN(hireRateCents)) return { error: "Hire rate must be zero or a positive number" };
  if (basisRaw && !BASES.has(basisRaw)) return { error: "Hire basis must be hour, day or month" };
  if (hireStart && hireEnd && hireEnd < hireStart) return { error: "Hire end date cannot be before the start date" };

  return { hireSupplier, hireRateCents, hireRateBasis, hireStart, hireEnd, hireNote, minBillHours };
}

// Create a brand-new machine already flagged as hired.
export async function createHiredAssetAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage the hire fleet" };
  }

  const code = formData.get("code")?.toString().trim().toUpperCase();
  const categoryId = formData.get("categoryId")?.toString();
  const brand = formData.get("brand")?.toString().trim() || null;
  const model = formData.get("model")?.toString().trim() || null;
  const meterTypeRaw = formData.get("meterType")?.toString();

  if (!code || !categoryId) {
    return { error: "Machine code and category are required" };
  }

  const hire = readHireFields(formData);
  if ("error" in hire) return hire;

  try {
    const existing = await prisma.asset.findUnique({ where: { code } });
    if (existing) return { error: `An asset with code "${code}" already exists` };

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return { error: "Selected category does not exist" };

    const meterType = meterTypeRaw === "KM" || meterTypeRaw === "HOURS" ? meterTypeRaw : category.defaultMeterType;

    const asset = await prisma.asset.create({
      data: {
        code,
        brand,
        model,
        categoryId,
        meterType,
        status: "ACTIVE",
        ownership: "HIRED",
        ...hire,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "Asset", entityId: asset.id,
        summary: `Added hired machine ${code} (${category.code})${hire.hireSupplier ? ` from ${hire.hireSupplier}` : ""}`,
      },
    });

    revalidatePath("/hire");
    revalidatePath("/fleet");
    return { success: true };
  } catch (err: unknown) {
    console.error("Create hired asset error:", err);
    return { error: errorMessage(err) || "Failed to add hired machine" };
  }
}

// Flag an existing (owned) asset as hired and attach hire terms.
export async function markAssetHiredAction(assetId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage the hire fleet" };
  }

  const hire = readHireFields(formData);
  if ("error" in hire) return hire;

  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { error: "Asset not found" };

    await prisma.asset.update({
      where: { id: assetId },
      data: { ownership: "HIRED", ...hire },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "Asset", entityId: assetId,
        summary: `Marked ${asset.code} as hired${hire.hireSupplier ? ` from ${hire.hireSupplier}` : ""}`,
      },
    });

    revalidatePath("/hire");
    revalidatePath("/fleet");
    return { success: true };
  } catch (err: unknown) {
    console.error("Mark asset hired error:", err);
    return { error: errorMessage(err) || "Failed to update asset" };
  }
}

// Update the hire terms of an already-hired machine.
export async function updateHireAction(assetId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage the hire fleet" };
  }

  const hire = readHireFields(formData);
  if ("error" in hire) return hire;

  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { error: "Asset not found" };

    await prisma.asset.update({
      where: { id: assetId },
      data: hire,
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "Asset", entityId: assetId,
        summary: `Updated hire terms for ${asset.code}`,
      },
    });

    revalidatePath("/hire");
    revalidatePath("/fleet");
    return { success: true };
  } catch (err: unknown) {
    console.error("Update hire error:", err);
    return { error: errorMessage(err) || "Failed to update hire terms" };
  }
}

// Take a machine off-hire: it stays in the fleet as an owned/returned asset,
// but leaves the hire list. Its hire history (dates, supplier) is kept.
export async function endHireAction(assetId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage the hire fleet" };
  }

  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { error: "Asset not found" };

    await prisma.asset.update({
      where: { id: assetId },
      data: { ownership: "OWNED", hireEnd: asset.hireEnd ?? new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "Asset", entityId: assetId,
        summary: `Ended hire for ${asset.code} (returned / off-hire)`,
      },
    });

    revalidatePath("/hire");
    revalidatePath("/fleet");
    return { success: true };
  } catch (err: unknown) {
    console.error("End hire error:", err);
    return { error: errorMessage(err) || "Failed to end hire" };
  }
}
