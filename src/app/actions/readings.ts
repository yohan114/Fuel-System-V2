"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { canUserAccessAsset } from "@/lib/assignments";
import { revalidatePath } from "next/cache";

export async function addReadingAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  // Time Lock check
  if (process.env.TEST_ENV !== "true") {
    const colomboHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10
    );
    if (colomboHour < 8 || colomboHour >= 17) {
      return { error: "Fuel operations are only allowed between 08:00 AM and 17:00 PM." };
    }
  }

  const assetId = formData.get("assetId")?.toString();
  const valueStr = formData.get("value")?.toString();
  const dateStr = formData.get("readingDate")?.toString();
  const adminOverride = formData.get("adminOverride") === "true";

  if (!assetId || !valueStr || !dateStr) {
    return { error: "Please fill in all required fields" };
  }

  const value = parseFloat(valueStr);
  const readingDate = new Date(dateStr);

  // Date Lock check (current day only)
  if (process.env.TEST_ENV !== "true") {
    const colomboTodayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    if (dateStr !== colomboTodayStr) {
      return { error: "You can only log operations for the current day." };
    }
  }

  if (isNaN(value) || value < 0) {
    return { error: "Please enter a valid positive meter reading" };
  }

  try {
    let asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { id: assetId },
          { code: assetId.trim().toUpperCase() },
          { regNo: assetId.trim().toUpperCase() }
        ]
      }
    });

    if (!asset) {
      // Auto-create under fallback category
      const otherCategory = await prisma.category.findFirst({
        where: { code: "OTHER" },
      });
      if (!otherCategory) {
        return { error: "Fallback asset category 'OTHER' is missing from the database" };
      }
      asset = await prisma.asset.create({
        data: {
          code: assetId.trim().toUpperCase(),
          categoryId: otherCategory.id,
          meterType: "KM",
          status: "ACTIVE",
          brand: "Quick Added",
          typeLabel: "Other Asset",
          projectId: user.projectId || null, // Auto-bind new asset to user's project
        }
      });
    } else {
      // Project-scoped users may only log against vehicles assigned to their
      // site for the working day (falls back to the legacy pin for vehicles that
      // have never been assigned).
      if (user.role === "USER" && user.projectId) {
        const ok = await canUserAccessAsset(user, asset.id, readingDate);
        if (!ok) {
          return { error: "This vehicle is not assigned to your site for the selected day." };
        }
      }
    }

    // Get the latest reading of the same type for this asset
    const latestReading = await prisma.meterReading.findFirst({
      where: {
        assetId: asset.id,
        readingType: asset.meterType,
      },
      orderBy: [
        { value: "desc" },
        { readingDate: "desc" }
      ]
    });

    if (latestReading && value < latestReading.value) {
      if (user.role === "ADMIN" && adminOverride) {
        // Proceed with admin override
      } else {
        return {
          error: `Reading value (${value}) is lower than the current reading (${latestReading.value}). Cumulative readings cannot go backwards.`,
          needsOverrideOption: user.role === "ADMIN",
        };
      }
    }

    // Write reading in transaction
    await prisma.$transaction(async (tx) => {
      const reading = await tx.meterReading.create({
        data: {
          assetId: asset.id,
          value,
          readingType: asset.meterType,
          readingDate,
          source: "MANUAL",
          recordedById: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entity: "MeterReading",
          entityId: reading.id,
          summary: `Logged reading ${value} ${asset.meterType} for asset ${asset.code}${adminOverride ? " (Admin Override)" : ""}`,
        },
      });
    });

    revalidatePath("/");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/readings");

    return { success: true };
  } catch (err: any) {
    console.error("Add reading error:", err);
    return { error: err.message || "Failed to add meter reading" };
  }
}
