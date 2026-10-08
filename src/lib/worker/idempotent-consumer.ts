// ============================================================================
// JOB-01: Idempotent Consumer & Deduplication Engine (Master Plan Section 8 & 13)
// Enforces at-least-once delivery safety by ensuring that replayed or retried
// outbox messages cannot duplicate external effects or business mutations.
// ============================================================================

export interface ConsumedEventRecord {
  consumerName: string;
  messageId: string;
  eventType: string;
  processedAt: Date;
}

export class IdempotentConsumerRegistry {
  private consumedRecords: Map<string, ConsumedEventRecord> = new Map();

  /**
   * Generates a unique deduplication key for a given consumer and outbox message.
   */
  private makeKey(consumerName: string, messageId: string): string {
    return `${consumerName}:${messageId}`;
  }

  /**
   * Checks whether this specific consumer has already successfully processed this message.
   */
  public async hasProcessed(consumerName: string, messageId: string): Promise<boolean> {
    const key = this.makeKey(consumerName, messageId);
    return this.consumedRecords.has(key);
  }

  /**
   * Atomically records successful processing of the message for this consumer.
   */
  public async markProcessed(
    consumerName: string,
    messageId: string,
    eventType: string,
    processedAt: Date = new Date()
  ): Promise<void> {
    const key = this.makeKey(consumerName, messageId);
    this.consumedRecords.set(key, {
      consumerName,
      messageId,
      eventType,
      processedAt,
    });
  }

  /**
   * Executes an outbox handler idempotently.
   * If the event was already processed by this consumer, execution is skipped and returns false.
   * If not yet processed, the action runs and is recorded upon success, returning true.
   */
  public async executeIdempotently<T>(
    consumerName: string,
    messageId: string,
    eventType: string,
    action: () => Promise<T>
  ): Promise<{ executed: boolean; result?: T }> {
    if (await this.hasProcessed(consumerName, messageId)) {
      return { executed: false };
    }

    const result = await action();
    await this.markProcessed(consumerName, messageId, eventType);
    return { executed: true, result };
  }

  /**
   * Returns the count of processed records (for diagnostics & test verification).
   */
  public getProcessedCount(): number {
    return this.consumedRecords.size;
  }

  /**
   * Clears in-memory records (for isolated test runs).
   */
  public clear(): void {
    this.consumedRecords.clear();
  }
}

// Global default singleton registry
export const defaultConsumerRegistry = new IdempotentConsumerRegistry();
