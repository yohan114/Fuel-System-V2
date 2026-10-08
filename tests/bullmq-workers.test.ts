// ============================================================================
// Phase 13 — BullMQ Background Job Worker Infrastructure Test Suite
// Reference: Fuel-System-V3 Plan Section 18 (Phase 13 — Background Jobs)
//
// Tests:
// 1. QueueManager job lifecycle (enqueue, dispatch, progress, completion)
// 2. Job deduplication via jobId
// 3. Transient failure retries and exponential backoff
// 4. Monthly billing worker with distributed locking & progress reporting
// 5. Report worker asynchronous aggregation
// 6. NestJS BillingService background job orchestration
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemoryQueueManager,
  getQueueManager,
  setQueueManager,
  QUEUE_NAMES,
  type JobContext,
} from "@/lib/queue/queue-manager";
import {
  processMonthlyBillingJob,
  enqueueMonthlyBillingJob,
  type MonthlyBillingJobData,
} from "@/lib/workers/billing-worker";
import {
  processReportJob,
  enqueueReportJob,
  type ReportJobData,
} from "@/lib/workers/report-worker";
import { BillingService } from "@/server/modules/billing/billing.service";
import * as generateModule from "@/lib/billing/generate";
import { prisma } from "@/lib/db";
import { setRedisClient, InMemoryCacheClient } from "@/lib/cache/redis";

describe("Phase 13: BullMQ Background Job Workers Subsystem", () => {
  let queueManager: InMemoryQueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setRedisClient(new InMemoryCacheClient());
    queueManager = new InMemoryQueueManager();
    setQueueManager(queueManager);
  });

  afterEach(async () => {
    await queueManager.closeAll();
  });

  // --------------------------------------------------------------------------
  // 1. Queue Manager Core Operations
  // --------------------------------------------------------------------------
  describe("1. Queue Manager Job Lifecycle", () => {
    it("enqueues and processes an asynchronous job to completion with progress reporting", async () => {
      const processedItems: string[] = [];

      // Register worker
      queueManager.registerWorker("test-queue", async (job: JobContext<{ item: string }>) => {
        await job.updateProgress(25);
        processedItems.push(job.data.item);
        await job.updateProgress(75);
        return { processed: true };
      });

      // Add job
      const handle = await queueManager.addJob("test-queue", "process-item", { item: "unit-test-item-1" });
      expect(handle.id).toBeDefined();

      // Wait for completion
      const completed = await queueManager.waitForJobCompletion("test-queue", handle.id);
      expect(completed.state).toBe("completed");
      expect(completed.progress).toBe(100);
      expect(completed.returnvalue).toEqual({ processed: true });
      expect(processedItems).toContain("unit-test-item-1");
    });

    it("enforces idempotent deduplication when same jobId is enqueued repeatedly", async () => {
      let executionCount = 0;
      queueManager.registerWorker("dedupe-queue", async () => {
        executionCount++;
        return "OK";
      });

      const fixedJobId = "unique-batch-999";
      const handle1 = await queueManager.addJob("dedupe-queue", "task", { foo: "bar" }, { jobId: fixedJobId });
      const handle2 = await queueManager.addJob("dedupe-queue", "task", { foo: "bar" }, { jobId: fixedJobId });

      expect(handle1.id).toBe(fixedJobId);
      expect(handle2.id).toBe(fixedJobId);

      await queueManager.waitForJobCompletion("dedupe-queue", fixedJobId);
      expect(executionCount).toBe(1);
    });

    it("retries failed jobs up to max attempts with backoff before marking failed", async () => {
      let runCount = 0;
      queueManager.registerWorker("failing-queue", async () => {
        runCount++;
        if (runCount < 3) {
          throw new Error("Temporary network timeout");
        }
        return "SUCCESS_ON_ATTEMPT_3";
      });

      const handle = await queueManager.addJob(
        "failing-queue",
        "retry-task",
        {},
        { attempts: 3, backoff: { type: "fixed", delay: 20 } }
      );

      const completed = await queueManager.waitForJobCompletion("failing-queue", handle.id);
      expect(completed.state).toBe("completed");
      expect(completed.returnvalue).toBe("SUCCESS_ON_ATTEMPT_3");
      expect(runCount).toBe(3);
    });

    it("marks job as failed and stores error reason when attempts are exhausted", async () => {
      queueManager.registerWorker("poison-queue", async () => {
        throw new Error("Fatal unrecoverable error");
      });

      const handle = await queueManager.addJob(
        "poison-queue",
        "poison-task",
        {},
        { attempts: 2, backoff: { type: "fixed", delay: 10 } }
      );

      const failedJob = await queueManager.waitForJobCompletion("poison-queue", handle.id);
      expect(failedJob.state).toBe("failed");
      expect(failedJob.failedReason).toContain("Fatal unrecoverable error");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Monthly Billing Background Worker
  // --------------------------------------------------------------------------
  describe("2. Monthly Billing Background Worker", () => {
    it("processes monthly billing job with distributed locking and progress tracking", async () => {
      const mockResult: generateModule.GenerateResult = {
        periodKey: "2026-08",
        created: 42,
        regenerated: 8,
        skippedFinalized: 5,
        skippedExisting: 2,
        skippedNotHere: 0,
        skippedBilledDirect: 0,
        noRate: 0,
        errors: [],
        assets: [
          { assetId: "a-1", assetCode: "CAB-101", status: "created" },
          { assetId: "a-2", assetCode: "EXC-201", status: "created" },
        ],
      };

      vi.spyOn(generateModule, "generateBillsForMonth").mockResolvedValue(mockResult);

      const progressUpdates: any[] = [];
      const dummyJobCtx: JobContext<MonthlyBillingJobData> = {
        id: "job-bill-test-1",
        name: "generate-monthly-bills",
        data: {
          year: 2026,
          month: 8,
          actorId: "admin-user-1",
          regenerate: true,
        },
        attemptsMade: 1,
        updateProgress: async (p) => {
          progressUpdates.push(p);
        },
      };

      const outcome = await processMonthlyBillingJob(dummyJobCtx);

      expect(outcome.periodKey).toBe("2026-08");
      expect(outcome.created).toBe(42);
      expect(outcome.regenerated).toBe(8);
      expect(outcome.totalAssets).toBe(2);
      expect(progressUpdates).toContain(5);
      expect(progressUpdates).toContain(15);
      expect(progressUpdates).toContain(90);
      expect(progressUpdates).toContain(100);
      expect(generateModule.generateBillsForMonth).toHaveBeenCalledWith({
        year: 2026,
        month: 8,
        actorId: "admin-user-1",
        regenerate: true,
        assetIds: undefined,
        basis: undefined,
      });
    });

    it("enqueues monthly billing job onto the billing queue", async () => {
      const handle = await enqueueMonthlyBillingJob({
        year: 2026,
        month: 9,
        projectId: "proj-101",
      });

      expect(handle.id).toMatch(/^billing_2026-09_proj-101_/);
      expect(handle.name).toBe("generate-monthly-bills");

      const status = await queueManager.getJob(QUEUE_NAMES.BILLING, handle.id);
      expect(status).not.toBeNull();
      expect(status?.data.year).toBe(2026);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Report & Analytics Background Worker
  // --------------------------------------------------------------------------
  describe("3. Report & Analytics Background Worker", () => {
    it("aggregates report consumption metrics asynchronously", async () => {
      vi.spyOn(prisma.fuelIssue, "count").mockResolvedValue(154 as any);
      vi.spyOn(prisma.fuelIssue, "aggregate").mockResolvedValue({
        _sum: { litres: 12450.5 },
      } as any);

      const dummyJobCtx: JobContext<ReportJobData> = {
        id: "report-job-test-1",
        name: "generate-report",
        data: {
          reportType: "consumption",
          periodKey: "2026-08",
          actorId: "finance-user",
        },
        attemptsMade: 1,
        updateProgress: async () => {},
      };

      const outcome = await processReportJob(dummyJobCtx);

      expect(outcome.reportType).toBe("consumption");
      expect(outcome.periodKey).toBe("2026-08");
      expect(outcome.recordCount).toBe(154);
      expect(outcome.summary.totalLitres).toBe(12450.5);
    });

    it("enqueues report job onto the reports queue", async () => {
      const handle = await enqueueReportJob({
        reportType: "site_summary",
        periodKey: "2026-08",
        projectId: "site-colombo",
        actorId: "user-1",
      });

      expect(handle.id).toMatch(/^report_site_summary_2026-08_/);
      expect(handle.name).toBe("generate-report");
    });
  });

  // --------------------------------------------------------------------------
  // 4. NestJS BillingService Background Job Integration
  // --------------------------------------------------------------------------
  describe("4. NestJS BillingService Queue Integration", () => {
    it("enqueues billing run and queries job status via BillingService", async () => {
      const billingService = new BillingService();

      const enqueued = await billingService.enqueueMonthlyBilling({
        year: 2026,
        month: 8,
        projectId: "site-kat",
      });

      expect(enqueued.success).toBe(true);
      expect(enqueued.status).toBe("enqueued");
      expect(enqueued.jobId).toBeDefined();

      const jobStatus = await billingService.getBillingJobStatus(enqueued.jobId);
      expect(jobStatus.id).toBe(enqueued.jobId);
      expect(jobStatus.data.year).toBe(2026);
      expect(jobStatus.data.month).toBe(8);
    });

    it("throws NotFoundException when querying a nonexistent job ID", async () => {
      const billingService = new BillingService();

      await expect(
        billingService.getBillingJobStatus("nonexistent-job-id-999")
      ).rejects.toThrow("Billing job 'nonexistent-job-id-999' not found");
    });
  });
});
