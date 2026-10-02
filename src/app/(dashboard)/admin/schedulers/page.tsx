import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Clock, Cpu, RefreshCw } from "lucide-react";
import { SchedulerControls } from "./SchedulerControls";

export default async function AdminSchedulersPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const settings = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          "scraper.enabled",
          "scraper.cron",
          "scraper.lastSync",
          "serviceSync.enabled",
          "serviceSync.lastRun",
          "backup.cron",
          "backup.retentionDays",
        ],
      },
    },
  });

  const getVal = (key: string) => settings.find((s) => s.key === key)?.value;

  const scraperEnabled = getVal("scraper.enabled") !== "false";
  const scraperCron = getVal("scraper.cron") || "0 6 * * *";
  const lastScraperSync = getVal("scraper.lastSync") || null;

  const serviceSyncEnabled = getVal("serviceSync.enabled") !== "false";
  const lastServiceRun = getVal("serviceSync.lastRun") || null;

  const backupCron = getVal("backup.cron") || "30 2 * * *";
  const backupRetentionDays = getVal("backup.retentionDays") || "7";

  const lastBackupLog = await prisma.auditLog.findFirst({
    where: { entity: "Database", action: "BACKUP" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-400" /> Background Schedulers & Automations
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Monitor and trigger the long-running in-process cron tasks: Ceypetco national fuel price scraper, WorkshopOne service sync, and nightly SQLite database vacuum backups.
        </p>
      </div>

      <SchedulerControls
        scraperEnabled={scraperEnabled}
        scraperCron={scraperCron}
        serviceSyncEnabled={serviceSyncEnabled}
        backupCron={backupCron}
        backupRetentionDays={backupRetentionDays}
        lastScraperSync={lastScraperSync}
        lastServiceRun={lastServiceRun}
        lastBackupDate={
          lastBackupLog
            ? new Date(lastBackupLog.createdAt).toLocaleString("en-GB")
            : null
        }
      />
    </div>
  );
}
