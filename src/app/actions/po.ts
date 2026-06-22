"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { normalize } from "@/lib/service/xref";
import { computeReorder } from "@/lib/service/reorder";
import { postStockMovement } from "@/lib/service/stock";
import { createPurchaseOrder, getPurchaseOrder, poProgress } from "@/lib/service/po";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function audit(actorId: string, action: string, entityId: string, summary: string) {
  await prisma.auditLog.create({ data: { actorId, action, entity: "FilterPurchaseOrder", entityId, summary } });
}

function revalidatePo(id: string) {
  revalidatePath("/service/orders");
  revalidatePath(`/service/orders/${id}`);
}

// Create a DRAFT PO from the current Reorder Planner suggestions, then open it.
export async function createPoFromReorderAction(formData: FormData) {
  const admin = await assertCan("manage");

  const coverMonths = Math.min(24, Math.max(1, parseInt(String(formData.get("cover") || "3"), 10) || 3));
  const leadMonths = Math.min(12, Math.max(0, parseInt(String(formData.get("lead") || "1"), 10) || 0));

  const { rows } = await computeReorder({ coverMonths, leadMonths });
  const lines = rows.map((r) => ({
    normalizedCode: r.key,
    filterNo: r.filterNo,
    category: r.category,
    qtyOrdered: r.orderQty,
    unitCostCents: r.avgUnitCents,
  }));

  if (lines.length === 0) {
    redirect("/service/orders");
  }

  const id = await createPurchaseOrder({ createdById: admin.id, lines });
  await audit(admin.id, "CREATE", id, `Drafted PO from reorder (${lines.length} lines, ${coverMonths}+${leadMonths} mo cover)`);
  revalidatePath("/service/orders");
  redirect(`/service/orders/${id}`);
}

// Start an empty DRAFT PO for manual entry.
export async function createBlankPoAction() {
  const admin = await assertCan("manage");
  const id = await createPurchaseOrder({ createdById: admin.id, lines: [] });
  await audit(admin.id, "CREATE", id, "Created blank PO");
  revalidatePath("/service/orders");
  redirect(`/service/orders/${id}`);
}

export async function addPoLineAction(formData: FormData) {
  const admin = await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status !== "DRAFT") return;

  const filterNo = String(formData.get("filterNo") || "").trim() || null;
  const normalizedCode = filterNo ? normalize(filterNo) : "";
  if (!normalizedCode) return;
  const category = String(formData.get("category") || "").trim() || null;
  const qtyOrdered = Math.max(1, parseInt(String(formData.get("qty") || "1"), 10) || 1);
  const unitStr = String(formData.get("unitCostLkr") || "").trim();
  const unitCostCents = unitStr ? Math.round(parseFloat(unitStr) * 100) : null;

  await prisma.filterPurchaseOrderLine.create({
    data: { purchaseOrderId: poId, normalizedCode, filterNo, category, qtyOrdered, unitCostCents },
  });
  revalidatePo(poId);
}

export async function removePoLineAction(formData: FormData) {
  await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const lineId = String(formData.get("lineId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status !== "DRAFT") return;
  await prisma.filterPurchaseOrderLine.deleteMany({ where: { id: lineId, purchaseOrderId: poId } });
  revalidatePo(poId);
}

export async function updatePoMetaAction(formData: FormData) {
  await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status === "CANCELLED" || po.status === "RECEIVED") return;
  const supplier = String(formData.get("supplier") || "").trim() || null;
  const note = String(formData.get("note") || "").trim() || null;
  await prisma.filterPurchaseOrder.update({ where: { id: poId }, data: { supplier, note } });
  revalidatePo(poId);
}

export async function markPoOrderedAction(formData: FormData) {
  const admin = await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status !== "DRAFT" || po.lines.length === 0) return;
  await prisma.filterPurchaseOrder.update({
    where: { id: poId },
    data: { status: "ORDERED", orderedAt: new Date() },
  });
  await audit(admin.id, "UPDATE", poId, `Marked ${po.poNumber} as ordered`);
  revalidatePo(poId);
}

export async function cancelPoAction(formData: FormData) {
  const admin = await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status === "RECEIVED" || po.status === "CANCELLED") return;
  await prisma.filterPurchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED" } });
  await audit(admin.id, "UPDATE", poId, `Cancelled ${po.poNumber}`);
  revalidatePo(poId);
}

// Receive a PO (fully or partially). Each line's received quantity comes in as
// `recv_<lineId>`, clamped to what's still outstanding. Every received unit is
// posted to the stock ledger as a RECEIPT (carrying the line's unit cost and a
// link back to this PO), so on-hand updates automatically.
export async function receivePoAction(formData: FormData) {
  const admin = await assertCan("manage");
  const poId = String(formData.get("poId") || "");
  const po = await getPurchaseOrder(poId);
  if (!po || po.status !== "ORDERED") return;

  let receivedUnits = 0;
  for (const line of po.lines) {
    const remaining = Math.max(0, line.qtyOrdered - line.qtyReceived);
    if (remaining <= 0) continue;
    const raw = parseInt(String(formData.get(`recv_${line.id}`) || "0"), 10);
    const qty = Math.min(remaining, Math.max(0, Number.isFinite(raw) ? raw : 0));
    if (qty <= 0) continue;

    await postStockMovement({
      normalizedCode: line.normalizedCode,
      filterNo: line.filterNo,
      delta: qty,
      reason: "RECEIPT",
      unitCostCents: line.unitCostCents,
      note: `PO ${po.poNumber}`,
      purchaseOrderId: po.id,
      createdById: admin.id,
    });
    await prisma.filterPurchaseOrderLine.update({
      where: { id: line.id },
      data: { qtyReceived: { increment: qty } },
    });
    receivedUnits += qty;
  }

  if (receivedUnits === 0) return;

  // Re-read to decide whether the PO is now fully received.
  const after = await getPurchaseOrder(poId);
  const fully = after ? poProgress(after.lines).fullyReceived : false;
  if (fully) {
    await prisma.filterPurchaseOrder.update({
      where: { id: poId },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });
  }

  await audit(admin.id, "UPDATE", poId, `Received ${receivedUnits} unit(s) against ${po.poNumber}${fully ? " — fully received" : " (partial)"}`);
  revalidatePo(poId);
  revalidatePath("/service/reorder");
  revalidatePath("/service/stock");
}
