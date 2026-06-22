"use server";

import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { addManualRef, deleteManualRef, rebuildIndex } from "@/lib/service/xref";
import { revalidatePath } from "next/cache";

// Add a manual cross-reference equivalent to a filter (admin only).
export async function addManualCrossRefAction(input: { catalogId: string; brand?: string; partNumber: string; note?: string }) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit cross-references" };
  }
  try {
    const id = await addManualRef(input);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "FilterCrossRef",
        entityId: id,
        summary: `Added cross-reference ${input.partNumber}${input.brand ? ` (${input.brand})` : ""}`,
      },
    });
    revalidatePath("/service/cross-reference");
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to add cross-reference" };
  }
}

export async function deleteManualCrossRefAction(xrefId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit cross-references" };
  }
  try {
    await deleteManualRef(xrefId);
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "DELETE", entity: "FilterCrossRef", entityId: xrefId, summary: "Removed a manual cross-reference" },
    });
    revalidatePath("/service/cross-reference");
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to remove cross-reference" };
  }
}

// Re-parse the catalog and rebuild the auto index (manual rows preserved).
export async function rebuildXrefAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to rebuild the index" };
  }
  try {
    const res = await rebuildIndex();
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "UPDATE", entity: "FilterCrossRef", summary: `Rebuilt cross-reference index (${res.indexed} entries from ${res.filters} filters)` },
    });
    revalidatePath("/service/cross-reference");
    return { success: true, ...res };
  } catch (err: any) {
    return { error: err.message || "Failed to rebuild index" };
  }
}
