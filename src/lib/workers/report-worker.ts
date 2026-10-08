// ============================================================================
// Phase 13 — Report & Analytics Background Worker
// Reference: Fuel-System-V3 Plan Section 18 (Phase 13 — Background Jobs)
//
// Processes asynchronous report aggregations and export generation in BullMQ.
// Prevents heavy CSV/Excel generation from holding HTTP connections open.
// ============================================================================

import { getQueueManager, QUEUE_NAMES, type JobContext, type JobHandle } from "@/lib/queue/queue-manager";
import { prisma } from "@/lib/db";

export interface ReportJobData {
  reportType: "consumption" | "site_summary" | "fuel_issues_export";
  periodKey: string;
  projectId?: string | null;
  actorId: string;
}

export interface ReportJobResult {
  reportType: string;
  periodKey: string;
  projectId?: string | null;
  recordCount: number;
  generatedAt: string;
  summary: Record<string, any>;
}

/**
 * Worker processor for asynchronous report generation.
 */
export async function processReportJob(
  job: JobContext<ReportJobData>
): Promise<ReportJobResult> {
  const { reportType, periodKey, projectId } = job.data;

  await job.updateProgress(10);

  const [yearStr, monthStr] = periodKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  await job.updateProgress(30);

  const where: any = {
    issueDate: { gte: startDate, lte: endDate },
    voided: false,
  };

  if (projectId) {
    where.bulkTank = { projectId };
  }

  const [count, totalLitresAgg] = await Promise.all([
    prisma.fuelIssue.count({ where }),
    prisma.fuelIssue.aggregate({
      where,
      _sum: { litres: true },
    }),
  ]);

  await job.updateProgress(80);

  const totalLitres = totalLitresAgg._sum.litres || 0;

  const result: ReportJobResult = {
    reportType,
    periodKey,
    projectId,
    recordCount: count,
    generatedAt: new Date().toISOString(),
    summary: {
      totalLitres,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
    },
  };

  await job.updateProgress(100);
  return result;
}

/**
 * Enqueues an asynchronous report generation job onto the reports queue.
 */
export async function enqueueReportJob(
  data: ReportJobData,
  options: { attempts?: number } = {}
): Promise<JobHandle<ReportJobData>> {
  const queueManager = getQueueManager();
  const jobId = `report_${data.reportType}_${data.periodKey}_${Date.now()}`;

  return queueManager.addJob<ReportJobData>(
    QUEUE_NAMES.REPORTS,
    "generate-report",
    data,
    {
      jobId,
      attempts: options.attempts ?? 2,
      removeOnComplete: true,
    }
  );
}

/**
 * Registers the report worker on boot
 */
export function registerReportWorker() {
  const queueManager = getQueueManager();
  return queueManager.registerWorker<ReportJobData, ReportJobResult>(
    QUEUE_NAMES.REPORTS,
    processReportJob
  );
}
