"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { normalize } from "@/lib/service/xref";

// Add (or update) a price-book entry for a filter part number. Used by the
// price-gap filler; the cross-reference engine reads FilterPrice live, so the
// new price takes effect immediately across the app.
export async function addFilterPriceAction(formData: FormData) {
  try {
    await assertCan("manage");
  } catch {
    return;
  }

  const supplierCode = String(formData.get("supplierCode") || "").trim();
  if (!supplierCode) return;
  const description = String(formData.get("description") || "").trim() || null;
  const rupees = parseFloat(String(formData.get("unitPrice") || "0"));
  const unitPriceCents = Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0;
  if (unitPriceCents <= 0) return;

  const normalizedCode = normalize(supplierCode);

  const existing = await prisma.filterPrice.findFirst({ where: { normalizedCode } });
  if (existing) {
    await prisma.filterPrice.update({
      where: { id: existing.id },
      data: { unitPriceCents, totalPriceCents: unitPriceCents, qty: 1, supplierCode, description: description ?? existing.description },
    });
  } else {
    await prisma.filterPrice.create({
      data: { supplierCode, normalizedCode, description, qty: 1, unitPriceCents, totalPriceCents: unitPriceCents },
    });
  }

  revalidatePath("/service/price-gaps");
}
