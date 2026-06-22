"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { normalize, type ConsumerType } from "@/lib/stock/classify";
import { postMovement, voidMovement, OverIssueError } from "@/lib/stock/post";
import { revalidatePath } from "next/cache";

function revalidateStore() {
  revalidatePath("/store/ledger");
  revalidatePath("/store/products");
  revalidatePath("/store/mapping");
}

function rupeesToCents(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

function posNum(raw: unknown): number {
  const n = parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function createProductAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to manage products." }; }

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Product name is required." };
  const existing = await prisma.product.findUnique({ where: { name }, select: { id: true } });
  if (existing) return { error: "A product with that name already exists." };

  const product = await prisma.product.create({
    data: {
      name,
      unit: String(formData.get("unit") || "L").trim() || "L",
      category: String(formData.get("category") || "").trim() || null,
      reorderLevel: posNum(formData.get("reorderLevel")) || null,
      unitPriceCents: rupeesToCents(String(formData.get("unitPrice") || "")),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id, action: "CREATE", entity: "Product", entityId: product.id,
      summary: `Added product ${product.name}`,
    },
  });
  revalidateStore();
  return { success: true, id: product.id };
}

export async function updateProductAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to manage products." }; }

  const id = String(formData.get("id") || "");
  if (!id) return { error: "Missing product id." };

  const data: Record<string, unknown> = {};
  const name = String(formData.get("name") || "").trim();
  if (name) data.name = name;
  const unit = String(formData.get("unit") || "").trim();
  if (unit) data.unit = unit;
  if (formData.has("category")) data.category = String(formData.get("category") || "").trim() || null;
  if (formData.has("reorderLevel")) data.reorderLevel = posNum(formData.get("reorderLevel")) || null;
  if (formData.has("unitPrice")) data.unitPriceCents = rupeesToCents(String(formData.get("unitPrice") || ""));
  if (formData.has("active")) data.active = String(formData.get("active")) === "true";

  await prisma.product.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "UPDATE", entity: "Product", entityId: id, summary: `Updated product ${name || id}` },
  });
  revalidateStore();
  return { success: true };
}

// ── Stock movements ────────────────────────────────────────────────────────────
export async function receiveStockAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to record stock receipts." }; }

  const productId = String(formData.get("productId") || "");
  if (!productId) return { error: "Select a product." };
  const qty = posNum(formData.get("qty"));
  if (qty <= 0) return { error: "Quantity must be greater than zero." };

  const dateStr = String(formData.get("txnDate") || "").trim();
  const txnDate = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();

  const { balanceAfter } = await postMovement({
    productId,
    kind: "RECEIPT",
    qtyReceived: qty,
    txnDate,
    description: String(formData.get("description") || "").trim() || null,
    mrNo: String(formData.get("mrNo") || "").trim() || null,
    remark: String(formData.get("note") || "").trim() || null,
    createdById: user.id,
    source: "manual",
  });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "CREATE", entity: "StockMovement", entityId: productId, summary: `Received ${qty} — balance now ${balanceAfter}` },
  });
  revalidateStore();
  return { success: true, balanceAfter };
}

export async function issueStockAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to issue stock." }; }

  const productId = String(formData.get("productId") || "");
  if (!productId) return { error: "Select a product." };
  const qty = posNum(formData.get("qty"));
  if (qty <= 0) return { error: "Quantity must be greater than zero." };

  const assetId = String(formData.get("assetId") || "").trim() || null;
  const projectId = String(formData.get("projectId") || "").trim() || null;
  const siteId = String(formData.get("siteId") || "").trim() || null;
  const description = String(formData.get("description") || "").trim() || null;

  let consumerType: ConsumerType = "UNKNOWN";
  if (assetId) consumerType = "ASSET";
  else if (projectId) consumerType = "PROJECT";

  const dateStr = String(formData.get("txnDate") || "").trim();
  const txnDate = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();

  try {
    const { balanceAfter } = await postMovement({
      productId,
      kind: "ISSUE",
      qtyIssued: qty,
      txnDate,
      consumerType,
      assetId,
      projectId: assetId ? null : projectId,
      siteId: assetId ? null : siteId,
      description,
      mrNo: String(formData.get("mrNo") || "").trim() || null,
      mtnNo: String(formData.get("mtnNo") || "").trim() || null,
      createdById: user.id,
      source: "manual",
    });

    // Record an unresolved alias for the Mapping screen when nothing matched.
    if (consumerType === "UNKNOWN" && description) {
      const rawNorm = normalize(description);
      if (rawNorm) {
        await prisma.consumerAlias.upsert({
          where: { rawNorm },
          update: { hitCount: { increment: 1 } },
          create: { rawText: description, rawNorm, hitCount: 1 },
        });
      }
    }

    await prisma.auditLog.create({
      data: { actorId: user.id, action: "CREATE", entity: "StockMovement", entityId: productId, summary: `Issued ${qty} — balance now ${balanceAfter}` },
    });
    revalidateStore();
    return { success: true, balanceAfter };
  } catch (e) {
    if (e instanceof OverIssueError) return { error: e.message };
    throw e;
  }
}

export async function voidStockMovementAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to void movements." }; }

  const id = String(formData.get("id") || "");
  if (!id) return { error: "Missing movement id." };

  try {
    await voidMovement(id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not void this movement." };
  }

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "UPDATE", entity: "StockMovement", entityId: id, summary: `Voided movement ${id}` },
  });
  revalidateStore();
  return { success: true };
}

// ── Mapping screen: resolve an alias and back-fill matching history ────────────
export async function resolveAliasAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to resolve mappings." }; }

  const aliasId = String(formData.get("aliasId") || "");
  if (!aliasId) return { error: "Missing alias id." };
  const targetType = String(formData.get("targetType") || "").toUpperCase() as ConsumerType;
  const assetId = String(formData.get("assetId") || "").trim() || null;
  const projectId = String(formData.get("projectId") || "").trim() || null;

  if (targetType === "ASSET" && !assetId) return { error: "Pick a machine to map to." };
  if (targetType === "PROJECT" && !projectId) return { error: "Pick a project to map to." };

  const alias = await prisma.consumerAlias.update({
    where: { id: aliasId },
    data: {
      targetType,
      assetId: targetType === "ASSET" ? assetId : null,
      projectId: targetType === "PROJECT" ? projectId : null,
      resolved: true,
    },
  });

  // Back-fill: link previously-unknown issues whose description matches.
  const candidates = await prisma.stockMovement.findMany({
    where: { kind: "ISSUE", OR: [{ consumerType: "UNKNOWN" }, { consumerType: null }], description: { not: null } },
    select: { id: true, description: true },
  });
  const matchIds = candidates.filter((m) => normalize(m.description) === alias.rawNorm).map((m) => m.id);
  if (matchIds.length) {
    await prisma.stockMovement.updateMany({
      where: { id: { in: matchIds } },
      data: {
        consumerType: targetType,
        assetId: targetType === "ASSET" ? assetId : null,
        projectId: targetType === "PROJECT" ? projectId : null,
      },
    });
  }

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "UPDATE", entity: "ConsumerAlias", entityId: aliasId, summary: `Mapped "${alias.rawText}" → ${targetType} (${matchIds.length} issues back-filled)` },
  });
  revalidateStore();
  return { success: true, backfilled: matchIds.length };
}
