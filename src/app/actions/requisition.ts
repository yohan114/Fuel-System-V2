"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { postMovement, OverIssueError } from "@/lib/stock/post";
import { revalidatePath } from "next/cache";

function revalidate() {
  revalidatePath("/store/requisitions");
  revalidatePath("/store/ledger");
  revalidatePath("/store/products");
}

function posNum(raw: unknown): number {
  const n = parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// A site / project manager (or storekeeper / admin) requests lubricant.
export async function createRequisitionAction(formData: FormData) {
  let user;
  try { user = await assertCan("create"); }
  catch { return { error: "You are not authorized to request stock." }; }

  const productId = String(formData.get("productId") || "");
  const projectId = String(formData.get("projectId") || "").trim() || null;
  if (!productId) return { error: "Select a product." };
  if (!projectId) return { error: "Select a project." };
  const qtyRequested = posNum(formData.get("qtyRequested"));
  if (qtyRequested <= 0) return { error: "Quantity must be greater than zero." };

  const req = await prisma.requisition.create({
    data: {
      productId,
      projectId,
      siteId: String(formData.get("siteId") || "").trim() || null,
      qtyRequested,
      note: String(formData.get("note") || "").trim() || null,
      status: "PENDING",
      requestedById: user.id,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "CREATE", entity: "Requisition", entityId: req.id, summary: `Requested ${qtyRequested} of a product` },
  });
  revalidate();
  return { success: true };
}

// Store keeper approves & sends: stock leaves the store here (an ISSUE is posted
// against the project/site, over-issue-guarded), and the requisition moves to SENT.
export async function sendRequisitionAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to send stock." }; }

  const id = String(formData.get("id") || "");
  const req = await prisma.requisition.findUnique({ where: { id } });
  if (!req) return { error: "Requisition not found." };
  if (req.status !== "PENDING") return { error: "Only pending requisitions can be sent." };

  const qtySent = posNum(formData.get("qtySent")) || (req.qtyRequested ?? 0);
  if (qtySent <= 0) return { error: "Quantity to send must be greater than zero." };

  try {
    const mv = await postMovement({
      productId: req.productId,
      kind: "ISSUE",
      qtyIssued: qtySent,
      consumerType: "PROJECT",
      projectId: req.projectId,
      siteId: req.siteId,
      description: `Requisition dispatch`,
      source: "requisition",
      createdById: user.id,
    });
    await prisma.requisition.update({
      where: { id },
      data: { status: "SENT", qtySent, txnId: mv.id, approvedById: user.id, sentAt: new Date() },
    });
  } catch (e) {
    if (e instanceof OverIssueError) return { error: e.message };
    throw e;
  }

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "APPROVE", entity: "Requisition", entityId: id, summary: `Sent ${qtySent}` },
  });
  revalidate();
  return { success: true };
}

// The site confirms the quantity actually received; any shortfall is flagged.
export async function receiveRequisitionAction(formData: FormData) {
  let user;
  try { user = await assertCan("create"); }
  catch { return { error: "You are not authorized to confirm receipts." }; }

  const id = String(formData.get("id") || "");
  const req = await prisma.requisition.findUnique({ where: { id } });
  if (!req) return { error: "Requisition not found." };
  if (req.status !== "SENT") return { error: "Only sent requisitions can be received." };

  const qtyReceived = posNum(formData.get("qtyReceived"));
  if (qtyReceived <= 0) return { error: "Received quantity must be greater than zero." };
  const discrepancy = Math.abs(qtyReceived - (req.qtySent ?? 0)) > 0.0001;

  await prisma.requisition.update({
    where: { id },
    data: { status: "RECEIVED", qtyReceived, receivedById: user.id, receivedAt: new Date(), discrepancy },
  });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "UPDATE", entity: "Requisition", entityId: id, summary: `Received ${qtyReceived}${discrepancy ? " (discrepancy)" : ""}` },
  });
  revalidate();
  return { success: true, discrepancy };
}

export async function rejectRequisitionAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to reject requisitions." }; }

  const id = String(formData.get("id") || "");
  const req = await prisma.requisition.findUnique({ where: { id } });
  if (!req) return { error: "Requisition not found." };
  if (req.status !== "PENDING") return { error: "Only pending requisitions can be rejected." };

  await prisma.requisition.update({
    where: { id },
    data: { status: "REJECTED", rejectReason: String(formData.get("reason") || "").trim() || null, approvedById: user.id },
  });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "REJECT", entity: "Requisition", entityId: id, summary: `Rejected requisition` },
  });
  revalidate();
  return { success: true };
}

export async function cancelRequisitionAction(formData: FormData) {
  let user;
  try { user = await assertCan("create"); }
  catch { return { error: "You are not authorized to cancel requisitions." }; }

  const id = String(formData.get("id") || "");
  const req = await prisma.requisition.findUnique({ where: { id } });
  if (!req) return { error: "Requisition not found." };
  if (req.status !== "PENDING") return { error: "Only pending requisitions can be cancelled." };

  await prisma.requisition.update({ where: { id }, data: { status: "CANCELLED" } });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "UPDATE", entity: "Requisition", entityId: id, summary: `Cancelled requisition` },
  });
  revalidate();
  return { success: true };
}
