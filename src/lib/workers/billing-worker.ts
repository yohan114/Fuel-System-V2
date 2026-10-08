// ============================================================================
// Phase 13 — Monthly Billing Background Worker
// Reference: Fuel-System-V3 Plan Section 18 (Phase 13 — Background Jobs)
//
// Offloads heavy monthly billing batch runs to BullMQ background workers.
// Protects the run with Phase 12 distributed locking and emits progress updates.
// ============================================================================

import { getQueueManager, QUEUE_NAMES, type JobContext, type JobHandle } from "@/lib/queue/queue-manager";
import { generateBillsForMonth, type GenerateOptions, type GenerateResult } from "@/lib/billing/generate";
import { withDistributedLock } from "@/lib/cache/distributed-lock";
import type { RateBasis } from "@/lib/billing/calc";

export interface MonthlyBillingJobData {
  year: number;
  month: number;
  assetIds?: string[];
  regenerate?: boolean;
  actorId?: string | null;
  basis?: RateBasis;
  projectId?: string | null;
}

export interface MonthlyBillingJobResult {
  periodKey: string;
  created: number;
  regenerated: number;
  skippedFinalized: number;
  skippedExisting: number;
  skippedNotHere: number;
  skippedBilledDirect: number;
  noRate: number;
  errorCount: number;
  totalAssets: number;
}

/**
 * Worker processor function for monthly billing background jobs.
 * Enforces mutual exclusion using Phase 12 distributed lock.
 */
export async function processMonthlyBillingJob(
  job: JobContext<MonthlyBillingJobData>
): Promise<MonthlyBillingJobResult> {
  const { year, month, assetIds, regenerate, actorId, basis, projectId } = job.data;
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const lockResource = `billing:generate:${periodKey}:${projectId || "all"}`;

  await job.updateProgress(5);

  // Wrap in distributed lock to avoid concurrent overlapping runs
  return withDistributedLock(
    lockResource,
    async () => {
      await job.updateProgress(15);

      const opts: GenerateOptions = {
        year,
        month,
        assetIds,
        regenerate,
        actorId,
        basis,
      };

      const result: GenerateResult = await generateBillsForMonth(opts);

      await job.updateProgress(90);

      const jobResult: MonthlyBillingJobResult = {
        periodKey: result.periodKey,
        created: result.created,
        regenerated: result.regenerated,
        skippedFinalized: result.skippedFinalized,
        skippedExisting: result.skippedExisting,
        skippedNotHere: result.skippedNotHere,
        skippedBilledDirect: result.skippedBilledDirect,
        noRate: result.noRate,
        errorCount: result.errors.length,
        totalAssets: result.assets.length,
      };

      await job.updateProgress(100);
      return jobResult;
    },
    { ttlMs: 60_000, retries: 0 }
  );
}

/**
 * Enqueues a monthly billing batch job onto the BullMQ billing queue.
 */
export async function enqueueMonthlyBillingJob(
  data: MonthlyBillingJobData,
  options: { attempts?: number; delay?: number } = {}
): Promise<JobHandle<MonthlyBillingJobData>> {
  const queueManager = getQueueManager();
  const periodKey = `${data.year}-${String(data.month).padStart(2, "0")}`;
  const jobId = `billing_${periodKey}_${data.projectId || "all"}_${Date.now()}`;

  return queueManager.addJob<MonthlyBillingJobData>(
    QUEUE_NAMES.BILLING,
    "generate-monthly-bills",
    data,
    {
      jobId,
      attempts: options.attempts ?? 3,
      backoff: { type: "exponential", delay: 1000 },
      delay: options.delay ?? 0,
      removeOnComplete: true,
    }
  );
}

/**
 * Initializes and registers the monthly billing worker on application boot.
 */
export function registerBillingWorker() {
  const queueManager = getQueueManager();
  return queueManager.registerWorker<MonthlyBillingJobData, MonthlyBillingJobResult>(
    QUEUE_NAMES.BILLING,
    processMonthlyBillingJob
  );
}
