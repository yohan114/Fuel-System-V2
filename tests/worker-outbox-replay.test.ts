// ============================================================================
// JOB-01: Outbox Worker Retry & Replay Handling Test Suite
// Verifies:
// 1. Reliable at-least-once message processing across domain event types.
// 2. Exponential backoff calculation and retry window gating.
// 3. Poison pill quarantine & Dead-Letter Queue (DLQ) containment.
// 4. Crash recovery simulation (interrupted batch resumed on worker restart).
// 5. Replay safety (re-processing old batch causes ZERO duplicate side effects).
// 6. Dead-letter unquarantine and re-queue workflow.
// 7. Multi-consumer independent deduplication.
// ============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";
import { OutboxWorker } from "../src/lib/worker/outbox-worker";
import { IdempotentConsumerRegistry } from "../src/lib/worker/idempotent-consumer";
import type { OutboxRecord } from "../src/lib/worker/types";

describe("JOB-01: Outbox Worker Retry & Replay Handling", () => {
  let registry: IdempotentConsumerRegistry;
  let worker: OutboxWorker;

  beforeEach(() => {
    registry = new IdempotentConsumerRegistry();
    worker = new OutboxWorker(
      {
        maxRetries: 3, // Set to 3 for fast unit test assertion
        baseDelayMs: 1000,
        maxDelayMs: 8000,
        backoffFactor: 2,
      },
      registry
    );
  });

  function makeRecord(
    id: string,
    eventType: string,
    payload: Record<string, any>,
    overrides: Partial<OutboxRecord> = {}
  ): OutboxRecord {
    return {
      id,
      eventType,
      aggregateType: "FuelIssue",
      aggregateId: "agg-123",
      payloadJson: JSON.stringify(payload),
      createdAt: new Date(),
      processedAt: null,
      retryCount: 0,
      lastError: null,
      isDeadLetter: false,
      ...overrides,
    };
  }

  describe("1. Normal Outbox Processing & Dispatch", () => {
    it("successfully processes and acknowledges a batch of domain events", async () => {
      const fuelIssuedPayloads: any[] = [];
      const invoiceIssuedPayloads: any[] = [];

      worker.registerConsumer("FuelIssued", "FuelAuditConsumer", async (msg, payload) => {
        fuelIssuedPayloads.push(payload);
      });

      worker.registerConsumer("InvoiceIssued", "FinanceJournalConsumer", async (msg, payload) => {
        invoiceIssuedPayloads.push(payload);
      });

      const batch: OutboxRecord[] = [
        makeRecord("msg-1", "FuelIssued", { litres: 120, assetCode: "CAT-320" }),
        makeRecord("msg-2", "InvoiceIssued", { invoiceNumber: "EC-INV-2026-0001", amountCents: 34591700 }),
        makeRecord("msg-3", "FuelIssued", { litres: 85, assetCode: "KOM-200" }),
      ];

      const res = await worker.processBatch(batch);

      expect(res.batchSize).toBe(3);
      expect(res.processedCount).toBe(3);
      expect(res.succeededCount).toBe(3);
      expect(res.failedCount).toBe(0);
      expect(res.deadLetterCount).toBe(0);

      expect(fuelIssuedPayloads.length).toBe(2);
      expect(invoiceIssuedPayloads.length).toBe(1);

      // Verify records are acknowledged with timestamp
      for (const rec of batch) {
        expect(rec.processedAt).not.toBeNull();
        expect(rec.lastError).toBeNull();
      }
    });

    it("safely acknowledges unknown/unregistered event types without blocking queue", async () => {
      const batch: OutboxRecord[] = [
        makeRecord("msg-unhandled", "SomeUnregisteredEvent", { foo: "bar" }),
      ];

      const res = await worker.processBatch(batch);

      expect(res.succeededCount).toBe(1);
      expect(batch[0].processedAt).not.toBeNull();
    });
  });

  describe("2. Transient Failure & Exponential Backoff Retries", () => {
    it("increments retry count and records error upon transient failure", async () => {
      let attempts = 0;
      worker.registerConsumer("FuelIssued", "FailingConsumer", async () => {
        attempts++;
        throw new Error("Downstream payment service timed out");
      });

      const rec = makeRecord("msg-fail-1", "FuelIssued", { litres: 50 });
      const res = await worker.processBatch([rec]);

      expect(res.failedCount).toBe(1);
      expect(attempts).toBe(1);
      expect(rec.processedAt).toBeNull();
      expect(rec.retryCount).toBe(1);
      expect(rec.lastError).toBe("Downstream payment service timed out");
      expect(rec.isDeadLetter).toBe(false);
    });

    it("calculates accurate exponential backoff intervals", () => {
      // Base: 1000ms, factor: 2, max: 8000ms
      expect(worker.calculateBackoffDelay(0)).toBe(0);
      expect(worker.calculateBackoffDelay(1)).toBe(1000); // 1000 * 2^0
      expect(worker.calculateBackoffDelay(2)).toBe(2000); // 1000 * 2^1
      expect(worker.calculateBackoffDelay(3)).toBe(4000); // 1000 * 2^2
      expect(worker.calculateBackoffDelay(4)).toBe(8000); // capped at maxDelayMs 8000
    });

    it("gates retried messages until the backoff window elapses", () => {
      const now = new Date("2026-10-08T10:00:05.000Z");
      const createdTwoSecAgo = new Date("2026-10-08T10:00:03.000Z");

      // retryCount = 2 requires delay = 2000ms. Elapsed = 2000ms -> eligible
      const eligible = makeRecord("msg-el", "FuelIssued", {}, {
        createdAt: createdTwoSecAgo,
        retryCount: 2,
      });
      expect(worker.isEligibleForProcessing(eligible, now)).toBe(true);

      // retryCount = 3 requires delay = 4000ms. Elapsed = 2000ms -> ineligible
      const ineligible = makeRecord("msg-inel", "FuelIssued", {}, {
        createdAt: createdTwoSecAgo,
        retryCount: 3,
      });
      expect(worker.isEligibleForProcessing(ineligible, now)).toBe(false);
    });
  });

  describe("3. Dead-Letter Queue (DLQ) Quarantine", () => {
    it("quarantines poison message to DLQ after exhausting max retries", async () => {
      worker.registerConsumer("FuelIssued", "PoisonConsumer", async () => {
        throw new Error("Persistent schema violation");
      });

      // Starts at retryCount = 2, maxRetries = 3, created in past so backoff has elapsed
      const past = new Date(Date.now() - 10000);
      const poison = makeRecord("msg-poison", "FuelIssued", {}, { retryCount: 2, createdAt: past });
      const healthy = makeRecord("msg-healthy", "OtherEvent", {});

      const res = await worker.processBatch([poison, healthy]);

      expect(res.deadLetterCount).toBe(1);
      expect(poison.isDeadLetter).toBe(true);
      expect(poison.retryCount).toBe(3);
      expect(poison.lastError).toContain("[DEAD_LETTER] Exceeded maximum retries (3)");

      // Healthy message in same batch was processed without head-of-line blocking
      expect(res.succeededCount).toBe(1);
      expect(healthy.processedAt).not.toBeNull();
    });

    it("immediately quarantines messages with malformed JSON payloads", async () => {
      const malformed: OutboxRecord = {
        id: "msg-bad-json",
        eventType: "FuelIssued",
        aggregateType: "FuelIssue",
        aggregateId: "agg-1",
        payloadJson: "{ this is invalid json !!!",
        createdAt: new Date(),
        processedAt: null,
        retryCount: 0,
        lastError: null,
      };

      const res = await worker.processBatch([malformed]);

      expect(res.deadLetterCount).toBe(1);
      expect(malformed.isDeadLetter).toBe(true);
      expect(malformed.lastError).toContain("[DEAD_LETTER] Malformed payload JSON");
    });
  });

  describe("4. Replay Safety & Idempotent Consumer Deduplication", () => {
    it("executes external side effects exactly once even during message replays", async () => {
      let externalSideEffectCount = 0;

      worker.registerConsumer("InvoiceIssued", "ExternalAccountingPoster", async (msg, payload) => {
        externalSideEffectCount++;
      });

      const message = makeRecord("msg-inv-99", "InvoiceIssued", { invoiceNumber: "INV-001" });

      // First run: executes side effect
      const run1 = await worker.processBatch([message]);
      expect(run1.succeededCount).toBe(1);
      expect(externalSideEffectCount).toBe(1);

      // Reset message's processedAt to simulate queue replay / redelivery
      message.processedAt = null;

      // Second run (replayed): consumer registry detects duplicate, executes 0 side effects
      const run2 = await worker.processBatch([message]);
      expect(run2.succeededCount).toBe(1);
      expect(run2.idempotentNoOpCount).toBe(1);
      expect(externalSideEffectCount).toBe(1); // ZERO duplicate calls!
    });

    it("skips already acknowledged messages during bulk batch polling", async () => {
      const processedMsg = makeRecord("msg-already-done", "FuelIssued", {}, {
        processedAt: new Date(),
      });

      const res = await worker.processBatch([processedMsg]);
      expect(res.skippedCount).toBe(1);
      expect(res.processedCount).toBe(0);
    });
  });

  describe("5. Crash Recovery Simulation", () => {
    it("resumes unacknowledged messages after simulated mid-batch worker crash", async () => {
      const processedIds: string[] = [];
      worker.registerConsumer("FuelIssued", "AuditLogger", async (msg) => {
        processedIds.push(msg.id);
      });

      const batch = [
        makeRecord("msg-1", "FuelIssued", { n: 1 }),
        makeRecord("msg-2", "FuelIssued", { n: 2 }),
        makeRecord("msg-3", "FuelIssued", { n: 3 }),
        makeRecord("msg-4", "FuelIssued", { n: 4 }),
      ];

      // Run 1: Crash after processing index 1 (msg-1 and msg-2 processed, msg-3 and msg-4 unacknowledged)
      const crashRun = await worker.processBatch(batch, { crashAfterIndex: 1 });
      expect(crashRun.processedCount).toBe(2);
      expect(crashRun.succeededCount).toBe(2);
      expect(processedIds).toEqual(["msg-1", "msg-2"]);

      expect(batch[0].processedAt).not.toBeNull();
      expect(batch[1].processedAt).not.toBeNull();
      expect(batch[2].processedAt).toBeNull();
      expect(batch[3].processedAt).toBeNull();

      // Run 2: Worker restarts and re-processes the batch
      const restartRun = await worker.processBatch(batch);
      expect(restartRun.skippedCount).toBe(2); // msg-1 and msg-2 were already acknowledged
      expect(restartRun.succeededCount).toBe(2); // msg-3 and msg-4 now processed
      expect(processedIds).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
    });
  });

  describe("6. Dead-Letter Recovery & Replay Workflow", () => {
    it("unquarantines dead letters and processes successfully after bug resolution", async () => {
      let isBugFixed = false;
      worker.registerConsumer("FuelIssued", "BuggyConsumer", async () => {
        if (!isBugFixed) {
          throw new Error("Temporary bug");
        }
      });

      const past = new Date(Date.now() - 10000);
      const record = makeRecord("msg-buggy", "FuelIssued", {}, { retryCount: 2, createdAt: past });

      // Run 1: Fails to dead letter
      await worker.processBatch([record]);
      expect(record.isDeadLetter).toBe(true);

      // Admin resolves bug and re-queues dead letters
      isBugFixed = true;
      const replayedCount = worker.replayDeadLetters([record]);
      expect(replayedCount).toBe(1);
      expect(record.isDeadLetter).toBe(false);
      expect(record.retryCount).toBe(0);

      // Run 2: Re-processed successfully
      const res = await worker.processBatch([record]);
      expect(res.succeededCount).toBe(1);
      expect(record.processedAt).not.toBeNull();
    });
  });

  describe("7. Multi-Consumer Independent Deduplication", () => {
    it("allows multiple independent consumers to deduplicate separately", async () => {
      const consumerAProcessed: string[] = [];
      const consumerBProcessed: string[] = [];

      worker.registerConsumer("FuelIssued", "ConsumerA", async (msg) => {
        consumerAProcessed.push(msg.id);
      });

      worker.registerConsumer("FuelIssued", "ConsumerB", async (msg) => {
        consumerBProcessed.push(msg.id);
      });

      const msg = makeRecord("msg-multi", "FuelIssued", {});

      await worker.processBatch([msg]);

      expect(consumerAProcessed).toEqual(["msg-multi"]);
      expect(consumerBProcessed).toEqual(["msg-multi"]);
    });
  });
});
