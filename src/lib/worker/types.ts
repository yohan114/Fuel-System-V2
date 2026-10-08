// ============================================================================
// JOB-01: Transactional Outbox Worker Types & Contracts (Master Plan Wave D)
// Defines durable message envelopes, retry policies, consumer contracts,
// and execution outcome metrics.
// ============================================================================

export interface OutboxRecord {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: string;
  createdAt: Date;
  processedAt: Date | null;
  retryCount: number;
  lastError: string | null;
  isDeadLetter?: boolean;
}

export type OutboxHandler<T = any> = (
  message: OutboxRecord,
  payload: T
) => Promise<void>;

export interface RegisteredConsumer {
  consumerName: string;
  eventType: string;
  handler: OutboxHandler;
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffFactor: 2,
};

export interface WorkerProcessResult {
  batchSize: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  deadLetterCount: number;
  skippedCount: number;
  idempotentNoOpCount: number;
}
