"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

export async function logDailyConditionAction(assetId: string, status: string, note: string | null = null) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to log machine conditions" };
  }

  if (status !== "WORKING" && status !== "BREAKDOWN") {
    return { error: "Invalid status value. Must be WORKING or BREAKDOWN." };
  }

  // Daily logging allowed only between 8:00 AM and 17:00 PM
  const colomboHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Colombo",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
  if (colomboHour < 8 || colomboHour >= 17) {
    return { error: "Condition logging is only allowed between 8:00 AM and 17:00 PM." };
  }

  // Daily logDate truncated to Colombo local midnight YYYY-MM-DD
  const colomboTodayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [colomboYear, colomboMonth, colomboDay] = colomboTodayStr.split("-").map(Number);
  const logDate = new Date(colomboYear, colomboMonth - 1, colomboDay);

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return { error: "Asset not found" };
    }

    // Check project user scope
    if (user.role === "USER" && user.projectId && asset.projectId !== user.projectId) {
      return { error: "Asset does not belong to your assigned project" };
    }

    // Only ADMIN can restore a machine from INACTIVE (breakdown) to WORKING
    if (status === "WORKING" && asset.status === "INACTIVE" && user.role !== "ADMIN") {
      return { error: "Only an admin can mark a machine as Working when it is in Breakdown." };
    }

    // Upsert condition log for this asset and date
    const condition = await prisma.dailyCondition.upsert({
      where: {
        assetId_logDate: {
          assetId,
          logDate,
        },
      },
      update: {
        status,
        note,
        recordedById: user.id,
      },
      create: {
        assetId,
        status,
        note,
        logDate,
        recordedById: user.id,
      },
    });

    // Also sync status in the Asset table so that it displays in fleet list correctly!
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: status === "WORKING" ? "ACTIVE" : "INACTIVE",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entity: "Asset",
        entityId: assetId,
        summary: `Set daily machine condition of ${asset.code} to ${status}`,
      },
    });

    revalidatePath("/");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Log daily condition error:", err);
    return { error: err.message || "Failed to log daily machine condition" };
  }
}
