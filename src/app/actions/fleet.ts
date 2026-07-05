"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

export async function createAssetAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const code = formData.get("code")?.toString().trim().toUpperCase();
  const brand = formData.get("brand")?.toString().trim() || null;
  const typeLabel = formData.get("typeLabel")?.toString().trim() || null;
  const model = formData.get("model")?.toString().trim() || null;
  const regNo = formData.get("regNo")?.toString().trim() || null;
  const capacity = formData.get("capacity")?.toString().trim() || null;
  const yomStr = formData.get("yom")?.toString();
  const chassisNo = formData.get("chassisNo")?.toString().trim() || null;
  const engineNo = formData.get("engineNo")?.toString().trim() || null;
  const serialNo = formData.get("serialNo")?.toString().trim() || null;
  const site = formData.get("site")?.toString().trim() || null;
  const categoryId = formData.get("categoryId")?.toString();
  const meterType = formData.get("meterType")?.toString() || "KM";
  const dailyCapStr = formData.get("dailyCapLitres")?.toString();
  const dailyCapParsed = dailyCapStr && dailyCapStr.trim() !== "" ? parseInt(dailyCapStr, 10) : null;
  const dailyCapLitres = dailyCapParsed != null && !isNaN(dailyCapParsed) && dailyCapParsed > 0 ? dailyCapParsed : null;

  if (!code || !categoryId) {
    return { error: "Asset Code and Category are required fields" };
  }

  const yom = yomStr ? parseInt(yomStr, 10) : null;

  try {
    const existing = await prisma.asset.findUnique({
      where: { code },
    });

    if (existing) {
      return { error: `An asset with code "${code}" already exists` };
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return { error: "Selected category does not exist" };
    }

    const asset = await prisma.asset.create({
      data: {
        code,
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom: isNaN(yom as any) ? null : yom,
        chassisNo,
        engineNo,
        serialNo,
        site,
        categoryId,
        meterType,
        dailyCapLitres,
        status: "ACTIVE",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "Asset",
        entityId: asset.id,
        summary: `Created asset ${code} under category ${category.code}`,
      },
    });

    revalidatePath("/fleet");
    return { success: true };
  } catch (err: any) {
    console.error("Create asset error:", err);
    return { error: err.message || "Failed to create asset" };
  }
}

export async function updateAssetAction(assetId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const brand = formData.get("brand")?.toString().trim() || null;
  const typeLabel = formData.get("typeLabel")?.toString().trim() || null;
  const model = formData.get("model")?.toString().trim() || null;
  const regNo = formData.get("regNo")?.toString().trim() || null;
  const capacity = formData.get("capacity")?.toString().trim() || null;
  const yomStr = formData.get("yom")?.toString();
  const chassisNo = formData.get("chassisNo")?.toString().trim() || null;
  const engineNo = formData.get("engineNo")?.toString().trim() || null;
  const serialNo = formData.get("serialNo")?.toString().trim() || null;
  const site = formData.get("site")?.toString().trim() || null;
  const status = formData.get("status")?.toString() || "ACTIVE";
  const meterType = formData.get("meterType")?.toString() || "KM";
  const dailyCapStr = formData.get("dailyCapLitres")?.toString();
  const dailyCapParsed = dailyCapStr && dailyCapStr.trim() !== "" ? parseInt(dailyCapStr, 10) : null;
  const dailyCapLitres = dailyCapParsed != null && !isNaN(dailyCapParsed) && dailyCapParsed > 0 ? dailyCapParsed : null;

  const yom = yomStr ? parseInt(yomStr, 10) : null;

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return { error: "Asset not found" };
    }

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: {
        brand,
        typeLabel,
        model,
        regNo,
        capacity,
        yom: isNaN(yom as any) ? null : yom,
        chassisNo,
        engineNo,
        serialNo,
        site,
        status,
        meterType,
        dailyCapLitres,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Asset",
        entityId: assetId,
        summary: `Updated asset ${asset.code} fields`,
      },
    });

    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Update asset error:", err);
    return { error: err.message || "Failed to update asset" };
  }
}

export async function deleteAssetAction(assetId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return { error: "Asset not found" };
    }

    // Soft delete by updating status to DISPOSED (keeps historical issue/reading logs intact)
    await prisma.asset.update({
      where: { id: assetId },
      data: { status: "DISPOSED" },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "DELETE",
        entity: "Asset",
        entityId: assetId,
        summary: `Marked asset ${asset.code} as DISPOSED`,
      },
    });

    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Delete asset error:", err);
    return { error: err.message || "Failed to dispose asset" };
  }
}
