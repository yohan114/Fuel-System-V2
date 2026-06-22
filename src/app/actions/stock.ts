"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { normalize } from "@/lib/service/xref";
import { postStockMovement, setStockTo } from "@/lib/service/stock";
import { revalidatePath } from "next/cache";

function revalidateStock() {
  revalidatePath("/service/reorder");
  revalidatePath("/service/stock");
}

// Set the on-hand quantity for a filter (keyed by its demand/normalized code).
// Posts the difference as an audited ADJUSTMENT movement rather than silently
// overwriting, so on-hand always has a paper trail.
export async function setFilterStockAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return;
  }

  const normalizedCode = String(formData.get("normalizedCode") || "").trim();
  if (!normalizedCode) return;
  const filterNo = String(formData.get("filterNo") || "").trim() || null;
  const raw = parseInt(String(formData.get("onHand") || "0"), 10);
  const target = Number.isFinite(raw) && raw > 0 ? raw : 0;

  const before = (await prisma.filterStock.findUnique({ where: { normalizedCode } }))?.onHand ?? 0;
  if (target === before) return;

  await setStockTo(normalizedCode, target, { filterNo, createdById: admin.id });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entity: "FilterStock",
      entityId: normalizedCode,
      summary: `Adjusted on-hand stock for ${filterNo || normalizedCode}: ${before} → ${target}`,
    },
  });

  revalidateStock();
}

// Record a stock receipt (purchase / goods received) — adds to on-hand and
// captures the unit cost on the ledger row.
export async function receiveFilterStockAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to record stock receipts" };
  }

  let normalizedCode = String(formData.get("normalizedCode") || "").trim();
  const filterNo = String(formData.get("filterNo") || "").trim() || null;
  // Free-form receipt (no row key): derive the key from the part number.
  if (!normalizedCode && filterNo) normalizedCode = normalize(filterNo);
  if (!normalizedCode) return { error: "A filter part number is required" };

  const qty = parseInt(String(formData.get("qty") || "0"), 10);
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be greater than zero" };

  const unitCostStr = String(formData.get("unitCostLkr") || "").trim();
  const unitCostCents = unitCostStr ? Math.round(parseFloat(unitCostStr) * 100) : null;
  if (unitCostCents != null && (!Number.isFinite(unitCostCents) || unitCostCents < 0)) {
    return { error: "Unit cost must be zero or greater" };
  }
  const note = String(formData.get("note") || "").trim() || null;

  const balanceAfter = await postStockMovement({
    normalizedCode,
    filterNo,
    delta: qty,
    reason: "RECEIPT",
    unitCostCents,
    note,
    createdById: admin.id,
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "CREATE",
      entity: "FilterStock",
      entityId: normalizedCode,
      summary: `Received ${qty} × ${filterNo || normalizedCode}${
        unitCostCents != null ? ` @ Rs. ${(unitCostCents / 100).toLocaleString("en-LK")}` : ""
      } — on-hand now ${balanceAfter}`,
    },
  });

  revalidateStock();
  return { success: true, onHand: balanceAfter };
}
