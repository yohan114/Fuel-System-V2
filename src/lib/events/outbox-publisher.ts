// ============================================================================
// Phase 14 & 15 — Transactional Outbox Publisher Worker
// Reference: Fuel-System-V3 Plan Section 19 & 20 (Phase 14 & Phase 15)
//
// Bridges transactional outbox records to Kafka topics.
// Guarantees at-least-once delivery, partition key ordering, and DLQ quarantine.
// ============================================================================

import type { OutboxRecord } from "@/lib/worker/types";
import { getKafkaBroker, type IKafkaBroker } from "./kafka-producer";
import { buildKafkaEnvelope, resolveKafkaTopic } from "./topic-router";
import { getQueueManager, QUEUE_NAMES, type JobContext, type JobHandle } from "@/lib/queue/queue-manager";

export interface OutboxPublishBatchResult {
  batchSize: number;
  publishedCount: number;
  failedCount: number;
  deadLetterCount: number;
  skippedCount: number;
}

export class OutboxPublisher {
  constructor(
    private broker: IKafkaBroker = getKafkaBroker(),
    private maxRetries = 5
  ) {}

  /**
   * Publishes a single outbox record to its mapped Kafka topic.
   */
  async publishRecord(record: OutboxRecord): Promise<boolean> {
    const topic = resolveKafkaTopic(record.eventType);
    if (!topic) {
      // Event is not routed to Kafka; acknowledge without publishing
      record.processedAt = new Date();
      return true;
    }

    try {
      const envelope = buildKafkaEnvelope(record);
      await this.broker.publish(topic, [
        {
          key: envelope.key,
          value: JSON.stringify(envelope),
          headers: {
            eventType: record.eventType,
            eventId: record.id,
            timestamp: envelope.timestamp,
          },
        },
      ]);

      record.processedAt = new Date();
      record.lastError = null;
      return true;
    } catch (err: any) {
      record.retryCount++;
      record.lastError = err?.message || String(err);

      if (record.retryCount >= this.maxRetries) {
        record.isDeadLetter = true;
      }

      return false;
    }
  }

  /**
   * Publishes a batch of outbox records to Kafka.
   */
  async publishBatch(records: OutboxRecord[]): Promise<OutboxPublishBatchResult> {
    let publishedCount = 0;
    let failedCount = 0;
    let deadLetterCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      if (record.processedAt || record.isDeadLetter) {
        skippedCount++;
        continue;
      }

      const success = await this.publishRecord(record);
      if (success) {
        publishedCount++;
      } else {
        failedCount++;
        if (record.isDeadLetter) {
          deadLetterCount++;
        }
      }
    }

    return {
      batchSize: records.length,
      publishedCount,
      failedCount,
      deadLetterCount,
      skippedCount,
    };
  }
}

/**
 * BullMQ Job Processor for Outbox Publishing
 */
export async function processOutboxPublishJob(
  job: JobContext<{ records?: OutboxRecord[] }>
): Promise<OutboxPublishBatchResult> {
  const publisher = new OutboxPublisher();
  const records = job.data.records || [];

  await job.updateProgress(10);
  const result = await publisher.publishBatch(records);
  await job.updateProgress(100);

  return result;
}

/**
 * Enqueues an outbox publication batch job onto BullMQ
 */
export async function enqueueOutboxPublishJob(
  records: OutboxRecord[]
): Promise<JobHandle<{ records: OutboxRecord[] }>> {
  const queueManager = getQueueManager();
  return queueManager.addJob(
    QUEUE_NAMES.OUTBOX,
    "publish-outbox-batch",
    { records },
    {
      jobId: `outbox_pub_${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 500 },
      removeOnComplete: true,
    }
  );
}
