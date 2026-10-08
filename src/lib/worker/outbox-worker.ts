// ============================================================================
// JOB-01: Transactional Outbox Worker Engine (Master Plan Section 3, 8 & 13)
// Features:
// 1. At-least-once message delivery with exponential backoff retries.
// 2. Dead-letter queue (DLQ) quarantine for persistent failures / poison pills.
// 3. Idempotent consumer execution preventing duplicate external side-effects.
// 4. Batch processing, crash recovery, and replay safety.
// ============================================================================

import {
  DEFAULT_RETRY_POLICY,
  type OutboxHandler,
  type OutboxRecord,
  type RegisteredConsumer,
  type RetryPolicy,
  type WorkerProcessResult,
} from "./types";
import {
  IdempotentConsumerRegistry,
  defaultConsumerRegistry,
} from "./idempotent-consumer";

export class OutboxWorker {
  private policy: RetryPolicy;
  private consumers: Map<string, RegisteredConsumer[]> = new Map();
  private consumerRegistry: IdempotentConsumerRegistry;

  constructor(
    policy: Partial<RetryPolicy> = {},
    consumerRegistry: IdempotentConsumerRegistry = defaultConsumerRegistry
  ) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy };
    this.consumerRegistry = consumerRegistry;
  }

  /**
   * Registers a typed event consumer for a given domain event type.
   */
  public registerConsumer<T = any>(
    eventType: string,
    consumerName: string,
    handler: OutboxHandler<T>
  ): void {
    const list = this.consumers.get(eventType) || [];
    list.push({ consumerName, eventType, handler });
    this.consumers.set(eventType, list);
  }

  /**
   * Calculates exponential backoff delay in milliseconds.
   * Formula: min(maxDelayMs, baseDelayMs * (backoffFactor ^ retryCount))
   */
  public calculateBackoffDelay(retryCount: number): number {
    if (retryCount <= 0) return 0;
    const exp = Math.pow(this.policy.backoffFactor, retryCount - 1);
    const delay = this.policy.baseDelayMs * exp;
    return Math.min(delay, this.policy.maxDelayMs);
  }

  /**
   * Determines whether an outbox message is eligible for immediate processing.
   */
  public isEligibleForProcessing(record: OutboxRecord, now: Date = new Date()): boolean {
    // Already processed messages are not eligible for normal polling
    if (record.processedAt !== null) {
      return false;
    }

    // Dead-lettered messages are quarantined
    if (record.isDeadLetter || record.retryCount >= this.policy.maxRetries) {
      return false;
    }

    // Fresh messages are immediately eligible
    if (record.retryCount === 0) {
      return true;
    }

    // Retried messages must satisfy the exponential backoff window
    const delayMs = this.calculateBackoffDelay(record.retryCount);
    const elapsedMs = now.getTime() - record.createdAt.getTime();
    return elapsedMs >= delayMs;
  }

  /**
   * Processes a single outbox record against all registered consumers.
   */
  public async processRecord(
    record: OutboxRecord,
    now: Date = new Date()
  ): Promise<{
    status: "succeeded" | "failed" | "dead_letter" | "skipped";
    idempotentNoOps: number;
    error?: string;
  }> {
    // 1. Skip if already acknowledged
    if (record.processedAt !== null) {
      return { status: "skipped", idempotentNoOps: 0 };
    }

    // 2. Quarantine if already dead-lettered
    if (record.isDeadLetter || record.retryCount >= this.policy.maxRetries) {
      record.isDeadLetter = true;
      if (!record.lastError?.startsWith("[DEAD_LETTER]")) {
        record.lastError = `[DEAD_LETTER] Exceeded maximum retries (${this.policy.maxRetries}): ${record.lastError ?? "Unknown error"}`;
      }
      return { status: "dead_letter", idempotentNoOps: 0, error: record.lastError };
    }

    // 3. Parse JSON payload
    let payload: any = {};
    try {
      payload = JSON.parse(record.payloadJson);
    } catch (parseErr: any) {
      record.retryCount = this.policy.maxRetries;
      record.isDeadLetter = true;
      record.lastError = `[DEAD_LETTER] Malformed payload JSON: ${parseErr.message}`;
      return { status: "dead_letter", idempotentNoOps: 0, error: record.lastError };
    }

    // 4. Retrieve consumers for this event type
    const registered = this.consumers.get(record.eventType) || [];

    // If no handlers are registered, mark processed so the pipeline is not blocked
    if (registered.length === 0) {
      record.processedAt = now;
      record.lastError = null;
      return { status: "succeeded", idempotentNoOps: 0 };
    }

    // 5. Execute handlers idempotently
    let idempotentNoOps = 0;
    try {
      for (const consumer of registered) {
        const { executed } = await this.consumerRegistry.executeIdempotently(
          consumer.consumerName,
          record.id,
          record.eventType,
          async () => {
            await consumer.handler(record, payload);
          }
        );

        if (!executed) {
          idempotentNoOps++;
        }
      }

      // Mark success
      record.processedAt = now;
      record.lastError = null;
      return { status: "succeeded", idempotentNoOps };
    } catch (handlerErr: any) {
      // 6. Record failure & check DLQ threshold
      record.retryCount += 1;
      const errMsg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
      record.lastError = errMsg;

      if (record.retryCount >= this.policy.maxRetries) {
        record.isDeadLetter = true;
        record.lastError = `[DEAD_LETTER] Exceeded maximum retries (${this.policy.maxRetries}): ${errMsg}`;
        return { status: "dead_letter", idempotentNoOps, error: record.lastError };
      }

      return { status: "failed", idempotentNoOps, error: errMsg };
    }
  }

  /**
   * Processes a batch of outbox messages.
   * Supports crash simulation (stopping mid-batch) for resilience testing.
   */
  public async processBatch(
    records: OutboxRecord[],
    options: {
      now?: Date;
      crashAfterIndex?: number;
    } = {}
  ): Promise<WorkerProcessResult> {
    const now = options.now ?? new Date();
    const result: WorkerProcessResult = {
      batchSize: records.length,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      deadLetterCount: 0,
      skippedCount: 0,
      idempotentNoOpCount: 0,
    };

    for (let i = 0; i < records.length; i++) {
      if (options.crashAfterIndex !== undefined && i > options.crashAfterIndex) {
        // Simulated worker crash / interruption before acknowledging remaining messages
        break;
      }

      const record = records[i];

      // Skip already processed messages
      if (record.processedAt !== null) {
        result.skippedCount++;
        continue;
      }

      // Check backoff window eligibility
      if (!this.isEligibleForProcessing(record, now)) {
        result.skippedCount++;
        continue;
      }

      result.processedCount++;
      const outcome = await this.processRecord(record, now);
      result.idempotentNoOpCount += outcome.idempotentNoOps;

      switch (outcome.status) {
        case "succeeded":
          result.succeededCount++;
          break;
        case "failed":
          result.failedCount++;
          break;
        case "dead_letter":
          result.deadLetterCount++;
          break;
        case "skipped":
          result.skippedCount++;
          break;
      }
    }

    return result;
  }

  /**
   * Replays dead-lettered messages after root-cause remediation.
   * Resets retryCount and unsets dead-letter status.
   */
  public replayDeadLetters(records: OutboxRecord[]): number {
    let replayed = 0;
    for (const r of records) {
      if (r.isDeadLetter || (r.processedAt === null && r.retryCount >= this.policy.maxRetries)) {
        r.isDeadLetter = false;
        r.retryCount = 0;
        r.lastError = null;
        r.processedAt = null;
        replayed++;
      }
    }
    return replayed;
  }
}
