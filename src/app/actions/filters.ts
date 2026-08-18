"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

// Create/edit for the filter master. The /filters page was read-only (search +
// cross-reference); these let an admin add a new filter or fix its part numbers
// and price. Price is entered in LKR, stored as cents.

function priceToCents(raw: string | undefined | null): number | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  const n = parseFloat(s);
  if (isNaN(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

export async function createFilterAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage filters" };
  }

  const category = formData.get("category")?.toString().trim() || null;
  const hifiPartNo = formData.get("hifiPartNo")?.toString().trim() || null;
  const oemPartNo = formData.get("oemPartNo")?.toString().trim() || null;
  const description = formData.get("description")?.toString().trim() || null;
  const priceNote = formData.get("priceNote")?.toString().trim() || null;
  const priceCents = priceToCents(formData.get("price")?.toString());

  if (!hifiPartNo && !oemPartNo && !description) {
    return { error: "Give the filter at least a part number or a description" };
  }
  if (Number.isNaN(priceCents)) return { error: "Price must be zero or greater" };

  try {
    const filter = await prisma.filter.create({
      data: { category, hifiPartNo, oemPartNo, description, priceCents, priceNote },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "Filter", entityId: filter.id,
        summary: `Added filter ${hifiPartNo || oemPartNo || description}${priceCents != null ? ` @ Rs ${(priceCents / 100).toLocaleString("en-LK")}` : ""}`,
      },
    });
    revalidatePath("/filters");
    return { success: true };
  } catch (err: unknown) {
    console.error("Create filter error:", err);
    return { error: errorMessage(err) || "Failed to add filter" };
  }
}

export async function updateFilterAction(id: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage filters" };
  }

  const category = formData.get("category")?.toString().trim() || null;
  const hifiPartNo = formData.get("hifiPartNo")?.toString().trim() || null;
  const oemPartNo = formData.get("oemPartNo")?.toString().trim() || null;
  const description = formData.get("description")?.toString().trim() || null;
  const priceNote = formData.get("priceNote")?.toString().trim() || null;
  const priceCents = priceToCents(formData.get("price")?.toString());

  if (Number.isNaN(priceCents)) return { error: "Price must be zero or greater" };

  try {
    await prisma.filter.update({
      where: { id },
      data: { category, hifiPartNo, oemPartNo, description, priceCents, priceNote },
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "UPDATE", entity: "Filter", entityId: id, summary: `Updated filter ${hifiPartNo || oemPartNo || description || id}` },
    });
    revalidatePath("/filters");
    return { success: true };
  } catch (err: unknown) {
    console.error("Update filter error:", err);
    return { error: errorMessage(err) || "Failed to update filter" };
  }
}
