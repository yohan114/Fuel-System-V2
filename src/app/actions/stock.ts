"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

// Set the on-hand quantity for a filter (keyed by its demand/normalized code).
export async function setFilterStockAction(formData: FormData) {
  try {
    await assertCan("manage");
  } catch {
    return;
  }

  const normalizedCode = String(formData.get("normalizedCode") || "").trim();
  if (!normalizedCode) return;
  const filterNo = String(formData.get("filterNo") || "").trim() || null;
  const raw = parseInt(String(formData.get("onHand") || "0"), 10);
  const onHand = Number.isFinite(raw) && raw > 0 ? raw : 0;

  await prisma.filterStock.upsert({
    where: { normalizedCode },
    create: { normalizedCode, filterNo, onHand },
    update: { onHand, filterNo },
  });

  revalidatePath("/service/reorder");
}
