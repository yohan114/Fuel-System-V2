"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

// Master-data CRUD for the lubricant catalogue (oils/greases used on services).
// Price is entered in LKR and stored as cents per unit.

function priceToCents(raw: string | undefined | null): number | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  const n = parseFloat(s);
  if (isNaN(n) || n < 0) return NaN; // signal invalid
  return Math.round(n * 100);
}

export async function createLubricantAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage lubricants" };
  }

  const name = formData.get("name")?.toString().trim();
  const oilType = formData.get("oilType")?.toString().trim() || null;
  const unit = formData.get("unit")?.toString().trim() || "L";
  const note = formData.get("note")?.toString().trim() || null;
  const priceCents = priceToCents(formData.get("price")?.toString());

  if (!name) return { error: "Lubricant name/grade is required" };
  if (Number.isNaN(priceCents)) return { error: "Price must be zero or greater" };

  try {
    const lube = await prisma.lubricant.create({
      data: { name, oilType, unit, pricePerUnitCents: priceCents, note },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "Lubricant", entityId: lube.id,
        summary: `Added lubricant ${name}${oilType ? ` (${oilType})` : ""}${priceCents != null ? ` @ Rs ${(priceCents / 100).toLocaleString("en-LK")}/${unit}` : ""}`,
      },
    });
    revalidatePath("/lubricants");
    return { success: true };
  } catch (err: any) {
    console.error("Create lubricant error:", err);
    return { error: err.message || "Failed to add lubricant" };
  }
}

export async function updateLubricantAction(id: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage lubricants" };
  }

  const name = formData.get("name")?.toString().trim();
  const oilType = formData.get("oilType")?.toString().trim() || null;
  const unit = formData.get("unit")?.toString().trim() || "L";
  const note = formData.get("note")?.toString().trim() || null;
  const priceCents = priceToCents(formData.get("price")?.toString());
  const active = formData.get("active") != null ? formData.get("active") === "true" || formData.get("active") === "on" : true;

  if (!name) return { error: "Lubricant name/grade is required" };
  if (Number.isNaN(priceCents)) return { error: "Price must be zero or greater" };

  try {
    await prisma.lubricant.update({
      where: { id },
      data: { name, oilType, unit, pricePerUnitCents: priceCents, note, active },
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "UPDATE", entity: "Lubricant", entityId: id, summary: `Updated lubricant ${name}` },
    });
    revalidatePath("/lubricants");
    return { success: true };
  } catch (err: any) {
    console.error("Update lubricant error:", err);
    return { error: err.message || "Failed to update lubricant" };
  }
}

export async function deleteLubricantAction(id: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to manage lubricants" };
  }
  try {
    const lube = await prisma.lubricant.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "DELETE", entity: "Lubricant", entityId: id, summary: `Deleted lubricant ${lube.name}` },
    });
    revalidatePath("/lubricants");
    return { success: true };
  } catch (err: any) {
    console.error("Delete lubricant error:", err);
    return { error: err.message || "Failed to delete lubricant" };
  }
}
