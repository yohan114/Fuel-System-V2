"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

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
  // Fuel-only billing flag (private vehicles E&C fuels but does not rent).
  const billFuelOnly = !!formData.get("billFuelOnly");

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
        billFuelOnly,
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
  } catch (err: unknown) {
    console.error("Create asset error:", err);
    return { error: errorMessage(err) || "Failed to create asset" };
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
  // Fuel-only billing flag (private vehicles E&C fuels but does not rent).
  const billFuelOnly = !!formData.get("billFuelOnly");

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
        billFuelOnly,
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
  } catch (err: unknown) {
    console.error("Update asset error:", err);
    return { error: errorMessage(err) || "Failed to update asset" };
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
  } catch (err: unknown) {
    console.error("Delete asset error:", err);
    return { error: errorMessage(err) || "Failed to dispose asset" };
  }
}

// Bulk import assets from parsed CSV rows
export async function bulkImportAssetsAction(
  rows: {
    code: string;
    brand?: string;
    model?: string;
    regNo?: string;
    categoryCode?: string;
    meterType?: string;
    site?: string;
    dailyCapLitres?: number;
    billFuelOnly?: boolean;
  }[]
) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to import assets" };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No asset rows provided for import" };
  }

  try {
    const categories = await prisma.category.findMany();
    const catMap = new Map(categories.map((c) => [c.code.toUpperCase(), c.id]));
    const fallbackCat = categories.find((c) => c.code === "OTHER") || categories[0];

    let createdCount = 0;
    let updatedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const code = row.code?.trim().toUpperCase();
        if (!code) continue;

        const categoryId =
          (row.categoryCode && catMap.get(row.categoryCode.toUpperCase())) ||
          fallbackCat?.id;
        if (!categoryId) continue;

        const meterType = row.meterType?.toUpperCase() === "HOURS" ? "HOURS" : "KM";

        const existing = await tx.asset.findUnique({ where: { code } });
        if (existing) {
          await tx.asset.update({
            where: { id: existing.id },
            data: {
              brand: row.brand?.trim() || existing.brand,
              model: row.model?.trim() || existing.model,
              regNo: row.regNo?.trim() || existing.regNo,
              site: row.site?.trim() || existing.site,
              dailyCapLitres: row.dailyCapLitres ?? existing.dailyCapLitres,
              billFuelOnly: row.billFuelOnly ?? existing.billFuelOnly,
              status: "ACTIVE",
            },
          });
          updatedCount++;
        } else {
          await tx.asset.create({
            data: {
              code,
              categoryId,
              brand: row.brand?.trim() || null,
              model: row.model?.trim() || null,
              regNo: row.regNo?.trim() || null,
              meterType,
              site: row.site?.trim() || null,
              dailyCapLitres: row.dailyCapLitres ?? null,
              billFuelOnly: !!row.billFuelOnly,
              status: "ACTIVE",
            },
          });
          createdCount++;
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "IMPORT",
          entity: "Asset",
          summary: `Bulk imported assets: ${createdCount} created, ${updatedCount} updated`,
        },
      });
    });

    revalidatePath("/fleet");
    return {
      success: true,
      message: `Import complete: ${createdCount} new machines created, ${updatedCount} existing updated.`,
      createdCount,
      updatedCount,
    };
  } catch (err: unknown) {
    console.error("Bulk import assets error:", err);
    return { error: errorMessage(err) || "Failed to bulk import assets" };
  }
}

