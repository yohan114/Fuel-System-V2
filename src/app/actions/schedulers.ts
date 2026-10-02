"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { syncCeypetcoPrices } from "@/lib/prices/sync";
import { runWorkshopSync } from "@/lib/service/workshop-scheduler";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

export async function triggerPriceSyncAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to trigger price sync" };
  }

  try {
    const res = await syncCeypetcoPrices();
    const day = new Date().toISOString().split("T")[0];
    await prisma.setting.upsert({
      where: { key: "scraper.lastSync" },
      update: { value: day },
      create: { key: "scraper.lastSync", value: day },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        summary: `Manually triggered Ceypetco price sync: stored ${res.stored.length}, skipped ${res.skippedExisting.length}`,
      },
    });

    revalidatePath("/admin/schedulers");
    revalidatePath("/admin/prices");
    return {
      success: true,
      message: `Sync complete. ${res.stored.length} new prices stored, ${res.skippedExisting.length} existing skipped.`,
    };
  } catch (err: unknown) {
    console.error("Trigger price sync error:", err);
    return { error: errorMessage(err) || "Failed to sync Ceypetco prices" };
  }
}

export async function triggerWorkshopSyncAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to trigger workshop sync" };
  }

  try {
    await runWorkshopSync();

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "SYNC",
        entity: "ServiceRecord",
        summary: "Manually triggered WorkshopOne service records sync",
      },
    });

    revalidatePath("/admin/schedulers");
    revalidatePath("/service");
    return { success: true, message: "WorkshopOne sync completed successfully." };
  } catch (err: unknown) {
    console.error("Trigger workshop sync error:", err);
    return { error: errorMessage(err) || "Failed to sync WorkshopOne services" };
  }
}

export async function updateSchedulerConfigAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to update schedulers" };
  }

  const scraperEnabled = formData.get("scraperEnabled") === "true" ? "true" : "false";
  const scraperCron = formData.get("scraperCron")?.toString() || "0 6 * * *";
  const serviceSyncEnabled = formData.get("serviceSyncEnabled") === "true" ? "true" : "false";
  const backupCron = formData.get("backupCron")?.toString() || "30 2 * * *";
  const backupRetentionDays = formData.get("backupRetentionDays")?.toString() || "7";

  try {
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: "scraper.enabled" },
        update: { value: scraperEnabled },
        create: { key: "scraper.enabled", value: scraperEnabled },
      }),
      prisma.setting.upsert({
        where: { key: "scraper.cron" },
        update: { value: scraperCron },
        create: { key: "scraper.cron", value: scraperCron },
      }),
      prisma.setting.upsert({
        where: { key: "serviceSync.enabled" },
        update: { value: serviceSyncEnabled },
        create: { key: "serviceSync.enabled", value: serviceSyncEnabled },
      }),
      prisma.setting.upsert({
        where: { key: "backup.cron" },
        update: { value: backupCron },
        create: { key: "backup.cron", value: backupCron },
      }),
      prisma.setting.upsert({
        where: { key: "backup.retentionDays" },
        update: { value: backupRetentionDays },
        create: { key: "backup.retentionDays", value: backupRetentionDays },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Setting",
        summary: `Updated scheduler settings: scraper=${scraperEnabled}, serviceSync=${serviceSyncEnabled}, backupRetention=${backupRetentionDays}d`,
      },
    });

    revalidatePath("/admin/schedulers");
    return { success: true };
  } catch (err: unknown) {
    console.error("Update schedulers config error:", err);
    return { error: errorMessage(err) || "Failed to update scheduler configuration" };
  }
}
