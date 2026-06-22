"use server";

import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export type PriceKind = "oilPrice" | "oilType" | "filterCategory" | "filterPrice";

// Update one price-book unit price (admin only). One action handles all four
// editable lists so the client editor can be reused.
export async function updateServicePriceAction(input: { kind: PriceKind; id: string; unitLkr: number }) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit prices" };
  }

  const cents = Math.round(Number(input.unitLkr) * 100);
  if (!Number.isFinite(cents) || cents < 0) return { error: "Price must be zero or greater" };

  try {
    let label = "";
    switch (input.kind) {
      case "oilPrice": {
        const r = await prisma.oilPrice.update({ where: { id: input.id }, data: { unitPriceCents: cents } });
        label = `oil grade ${r.code}`;
        break;
      }
      case "oilType": {
        const r = await prisma.oilType.update({ where: { id: input.id }, data: { unitPriceCents: cents } });
        label = `oil line ${r.name}`;
        break;
      }
      case "filterCategory": {
        const r = await prisma.filterCategoryRef.update({ where: { id: input.id }, data: { unitPriceCents: cents } });
        label = `filter line ${r.name}`;
        break;
      }
      case "filterPrice": {
        const existing = await prisma.filterPrice.findUnique({ where: { id: input.id }, select: { qty: true } });
        if (!existing) return { error: "Price not found" };
        const r = await prisma.filterPrice.update({
          where: { id: input.id },
          data: { unitPriceCents: cents, totalPriceCents: cents * (existing.qty || 1) },
        });
        label = `filter ${r.supplierCode}`;
        break;
      }
      default:
        return { error: "Unknown price list" };
    }

    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "UPDATE", entity: "ServicePrice", entityId: input.id, summary: `Set ${label} price to Rs. ${(cents / 100).toLocaleString("en-LK")}` },
    });
    revalidatePath("/admin/service-prices");
    revalidatePath("/service/new");
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to update price" };
  }
}
