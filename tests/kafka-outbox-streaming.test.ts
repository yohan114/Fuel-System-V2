// ============================================================================
// Phase 14 & 15 — Transactional Outbox to Kafka Streaming Bridge Test Suite
// Reference: Fuel-System-V3 Plan Section 19 & 20 (Phase 14 & Phase 15)
//
// Tests:
// 1. Topic router: canonical Kafka topic resolution and CloudEvents envelope building
// 2. InMemoryKafkaBroker: topic pub/sub, message persistence, and isolation
// 3. OutboxPublisher: at-least-once batch publishing, retry policies, and DLQ quarantine
// 4. BullMQ background job integration for asynchronous outbox processing
// 5. EnterpriseEventConsumer: topic subscription, envelope deserialization, and idempotent deduplication
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KAFKA_TOPICS,
  resolveKafkaTopic,
  buildKafkaEnvelope,
  type KafkaEventEnvelope,
} from "@/lib/events/topic-router";
import {
  InMemoryKafkaBroker,
  setKafkaBroker,
  getKafkaBroker,
} from "@/lib/events/kafka-producer";
import {
  OutboxPublisher,
  processOutboxPublishJob,
  enqueueOutboxPublishJob,
} from "@/lib/events/outbox-publisher";
import { EnterpriseEventConsumer } from "@/lib/events/sample-consumer";
import { IdempotentConsumerRegistry } from "@/lib/worker/idempotent-consumer";
import {
  InMemoryQueueManager,
  setQueueManager,
  QUEUE_NAMES,
  type JobContext,
} from "@/lib/queue/queue-manager";
import type { OutboxRecord } from "@/lib/worker/types";

describe("Phase 14 & 15: Outbox-to-Kafka Event Streaming Bridge", () => {
  let broker: InMemoryKafkaBroker;
  let queueManager: InMemoryQueueManager;
  let consumerRegistry: IdempotentConsumerRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = new InMemoryKafkaBroker();
    setKafkaBroker(broker);
    queueManager = new InMemoryQueueManager();
    setQueueManager(queueManager);
    consumerRegistry = new IdempotentConsumerRegistry();
  });

  afterEach(async () => {
    await broker.disconnect();
    await queueManager.closeAll();
  });

  // --------------------------------------------------------------------------
  // 1. Topic Resolution & CloudEvents Envelope Router
  // --------------------------------------------------------------------------
  describe("1. Topic Resolution & CloudEvents Envelope", () => {
    it("maps domain event types to standard enterprise Kafka topics", () => {
      expect(resolveKafkaTopic("FuelIssued")).toBe(KAFKA_TOPICS.FUEL_ISSUE_CREATED);
      expect(resolveKafkaTopic("FuelVoided")).toBe(KAFKA_TOPICS.FUEL_ISSUE_VOIDED);
      expect(resolveKafkaTopic("FuelRequestApproved")).toBe(KAFKA_TOPICS.FUEL_REQUEST_APPROVED);
      expect(resolveKafkaTopic("BillFinalized")).toBe(KAFKA_TOPICS.BILLING_INVOICE_GENERATED);
      expect(resolveKafkaTopic("BillGenerated")).toBe(KAFKA_TOPICS.BILLING_INVOICE_GENERATED);
      expect(resolveKafkaTopic("PaymentReceived")).toBe(KAFKA_TOPICS.BILLING_PAYMENT_RECEIVED);
      expect(resolveKafkaTopic("MeterReadingLogged")).toBe(KAFKA_TOPICS.ASSET_METER_UPDATED);
    });

    it("returns null for unmapped internal events", () => {
      expect(resolveKafkaTopic("InternalCacheWarmed")).toBeNull();
      expect(resolveKafkaTopic("UserPasswordChanged")).toBeNull();
    });

    it("builds CloudEvents-compliant envelopes with aggregateId as partition key", () => {
      const record: OutboxRecord = {
        id: "outbox-uuid-101",
        eventType: "FuelIssued",
        aggregateType: "Vehicle",
        aggregateId: "veh-404-bowser",
        payloadJson: JSON.stringify({
          issueId: "iss-1",
          liters: 125.5,
          totalCost: 4500000,
          vehiclePlate: "WP-CAB-1234",
        }),
        createdAt: new Date("2026-03-30T10:00:00Z"),
        processedAt: null,
        retryCount: 0,
        lastError: null,
      };

      const envelope = buildKafkaEnvelope(record);

      expect(envelope.id).toBe("outbox-uuid-101");
      expect(envelope.eventType).toBe("FuelIssued");
      expect(envelope.topic).toBe("fuel.issue.created");
      expect(envelope.key).toBe("veh-404-bowser"); // Strict partition ordering by vehicle
      expect(envelope.timestamp).toBe("2026-03-30T10:00:00.000Z");
      expect(envelope.headers.source).toBe("fuel-system-v3");
      expect(envelope.headers.schemaVersion).toBe("1.0.0");
      expect(envelope.headers.correlationId).toBe("outbox-uuid-101");
      expect(envelope.payload).toEqual({
        issueId: "iss-1",
        liters: 125.5,
        totalCost: 4500000,
        vehiclePlate: "WP-CAB-1234",
      });
    });

    it("gracefully falls back when payloadJson is not standard JSON", () => {
      const record: OutboxRecord = {
        id: "outbox-raw-2",
        eventType: "FuelVoided",
        aggregateType: "FuelIssue",
        aggregateId: "iss-999",
        payloadJson: "plain-text-payload",
        createdAt: new Date(),
        processedAt: null,
        retryCount: 0,
        lastError: null,
      };

      const envelope = buildKafkaEnvelope(record);
      expect(envelope.payload).toEqual({ raw: "plain-text-payload" });
      expect(envelope.key).toBe("iss-999");
    });
  });

  // --------------------------------------------------------------------------
  // 2. In-Memory Kafka Streaming Broker
  // --------------------------------------------------------------------------
  describe("2. InMemoryKafkaBroker Pub/Sub", () => {
    it("publishes messages and delivers them asynchronously to subscribers", async () => {
      const received: any[] = [];
      const unsub = broker.subscribe("fuel.issue.created", async (msg) => {
        received.push(msg);
      });

      await broker.publish("fuel.issue.created", [
        {
          key: "asset-1",
          value: JSON.stringify({ event: "created", liters: 50 }),
        },
      ]);

      // Allow microtask/setTimeout dispatch
      await new Promise((r) => setTimeout(r, 20));

      expect(received).toHaveLength(1);
      expect(received[0].topic).toBe("fuel.issue.created");
      expect(received[0].key).toBe("asset-1");
      expect(JSON.parse(received[0].value)).toEqual({ event: "created", liters: 50 });

      // Clean up subscription
      unsub();
      await broker.publish("fuel.issue.created", [
        { key: "asset-2", value: "test2" },
      ]);
      await new Promise((r) => setTimeout(r, 20));

      expect(received).toHaveLength(1); // No new dispatch after unsubscribe
    });

    it("isolates topics and returns historical messages via inspection helpers", async () => {
      await broker.publish("fuel.issue.created", [{ key: "k1", value: "val1" }]);
      await broker.publish("billing.invoice.generated", [{ key: "k2", value: "val2" }]);

      expect(broker.getPublishedMessages("fuel.issue.created")).toHaveLength(1);
      expect(broker.getPublishedMessages("billing.invoice.generated")).toHaveLength(1);
      expect(broker.getPublishedMessages()).toHaveLength(2);

      broker.clear();
      expect(broker.getPublishedMessages()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Outbox Publisher Batch Worker
  // --------------------------------------------------------------------------
  describe("3. OutboxPublisher Delivery & Retries", () => {
    it("successfully publishes outbox batch to target Kafka topics and acknowledges records", async () => {
      const publisher = new OutboxPublisher(broker);

      const records: OutboxRecord[] = [
        {
          id: "rec-1",
          eventType: "FuelIssued",
          aggregateType: "Vehicle",
          aggregateId: "veh-001",
          payloadJson: JSON.stringify({ issueId: "i-1", liters: 200 }),
          createdAt: new Date(),
          processedAt: null,
          retryCount: 0,
          lastError: null,
        },
        {
          id: "rec-2",
          eventType: "BillFinalized",
          aggregateType: "Customer",
          aggregateId: "cust-55",
          payloadJson: JSON.stringify({ billId: "b-1", amountCents: 1500000 }),
          createdAt: new Date(),
          processedAt: null,
          retryCount: 0,
          lastError: null,
        },
      ];

      const result = await publisher.publishBatch(records);

      expect(result.batchSize).toBe(2);
      expect(result.publishedCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.deadLetterCount).toBe(0);
      expect(result.skippedCount).toBe(0);

      expect(records[0].processedAt).toBeInstanceOf(Date);
      expect(records[1].processedAt).toBeInstanceOf(Date);

      const published = broker.getPublishedMessages();
      expect(published).toHaveLength(2);
      expect(published[0].topic).toBe(KAFKA_TOPICS.FUEL_ISSUE_CREATED);
      expect(published[1].topic).toBe(KAFKA_TOPICS.BILLING_INVOICE_GENERATED);
    });

    it("skips records that are already processed or marked as dead-letter", async () => {
      const publisher = new OutboxPublisher(broker);

      const records: OutboxRecord[] = [
        {
          id: "rec-done",
          eventType: "FuelIssued",
          aggregateType: "Vehicle",
          aggregateId: "veh-001",
          payloadJson: "{}",
          createdAt: new Date(),
          processedAt: new Date(), // Already processed
          retryCount: 0,
          lastError: null,
        },
        {
          id: "rec-dlq",
          eventType: "FuelIssued",
          aggregateType: "Vehicle",
          aggregateId: "veh-002",
          payloadJson: "{}",
          createdAt: new Date(),
          processedAt: null,
          retryCount: 5,
          lastError: "Broker timeout",
          isDeadLetter: true, // DLQ quarantined
        },
      ];

      const result = await publisher.publishBatch(records);

      expect(result.skippedCount).toBe(2);
      expect(result.publishedCount).toBe(0);
      expect(broker.getPublishedMessages()).toHaveLength(0);
    });

    it("handles publish failures, increments retries, and quarantines to DLQ after max retries", async () => {
      const failingBroker: any = {
        publish: vi.fn().mockRejectedValue(new Error("Kafka connection timeout")),
      };

      const publisher = new OutboxPublisher(failingBroker, 3); // max 3 retries

      const record: OutboxRecord = {
        id: "rec-fail",
        eventType: "FuelIssued",
        aggregateType: "Vehicle",
        aggregateId: "veh-001",
        payloadJson: "{}",
        createdAt: new Date(),
        processedAt: null,
        retryCount: 2, // 1 retry remaining before DLQ
        lastError: null,
      };

      const success = await publisher.publishRecord(record);

      expect(success).toBe(false);
      expect(record.retryCount).toBe(3);
      expect(record.isDeadLetter).toBe(true); // Reached max retries -> quarantined
      expect(record.lastError).toContain("Kafka connection timeout");
    });
  });

  // --------------------------------------------------------------------------
  // 4. BullMQ Outbox Background Job Integration
  // --------------------------------------------------------------------------
  describe("4. BullMQ Outbox Job Integration", () => {
    it("executes outbox publish job with progress updates", async () => {
      const progressUpdates: Array<number | object | string | boolean> = [];
      const records: OutboxRecord[] = [
        {
          id: "job-rec-1",
          eventType: "FuelRequestApproved",
          aggregateType: "Request",
          aggregateId: "req-101",
          payloadJson: JSON.stringify({ requestId: "req-101", status: "APPROVED" }),
          createdAt: new Date(),
          processedAt: null,
          retryCount: 0,
          lastError: null,
        },
      ];

      const mockJob: JobContext<{ records?: OutboxRecord[] }> = {
        id: "job-outbox-1",
        name: "publish-outbox-batch",
        data: { records },
        attemptsMade: 1,
        updateProgress: async (p) => {
          progressUpdates.push(p);
        },
      };

      const result = await processOutboxPublishJob(mockJob);

      expect(result.publishedCount).toBe(1);
      expect(progressUpdates).toEqual([10, 100]);
      expect(broker.getPublishedMessages()).toHaveLength(1);
    });

    it("enqueues outbox publish jobs onto BullMQ queue manager", async () => {
      const records: OutboxRecord[] = [
        {
          id: "q-rec-1",
          eventType: "PaymentReceived",
          aggregateType: "Bill",
          aggregateId: "bill-88",
          payloadJson: "{}",
          createdAt: new Date(),
          processedAt: null,
          retryCount: 0,
          lastError: null,
        },
      ];

      const handle = await enqueueOutboxPublishJob(records);

      expect(handle).toBeDefined();
      const jobInfo = await queueManager.getJob(QUEUE_NAMES.OUTBOX, handle.id);
      expect(jobInfo).toBeDefined();
      expect(["waiting", "completed"]).toContain(jobInfo?.state);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Enterprise Consumer with Idempotent Deduplication
  // --------------------------------------------------------------------------
  describe("5. Enterprise Consumer & Idempotent Deduplication", () => {
    it("subscribes to topics, receives CloudEvents, and invokes registered handlers", async () => {
      const consumer = new EnterpriseEventConsumer("BillingAuditConsumer", broker, consumerRegistry);
      const consumedEvents: Array<KafkaEventEnvelope> = [];

      consumer.on("fuel.issue.created", async (envelope) => {
        consumedEvents.push(envelope);
      });

      consumer.start([KAFKA_TOPICS.FUEL_ISSUE_CREATED]);

      const publisher = new OutboxPublisher(broker);
      const record: OutboxRecord = {
        id: "audit-rec-1",
        eventType: "FuelIssued",
        aggregateType: "Vehicle",
        aggregateId: "veh-400",
        payloadJson: JSON.stringify({ issueId: "i-400", liters: 75 }),
        createdAt: new Date(),
        processedAt: null,
        retryCount: 0,
        lastError: null,
      };

      await publisher.publishRecord(record);

      // Wait for async dispatch
      await new Promise((r) => setTimeout(r, 30));

      expect(consumedEvents).toHaveLength(1);
      expect(consumedEvents[0].id).toBe("audit-rec-1");
      expect(consumedEvents[0].key).toBe("veh-400");
      expect(consumedEvents[0].payload.liters).toBe(75);

      const stats = consumer.getStats();
      expect(stats.messagesReceived).toBe(1);
      expect(stats.messagesProcessed).toBe(1);
      expect(stats.messagesDeduplicated).toBe(0);

      consumer.stop();
    });

    it("deduplicates redelivered messages using IdempotentConsumerRegistry", async () => {
      const consumer = new EnterpriseEventConsumer("DuplicateShieldConsumer", broker, consumerRegistry);
      let executionCount = 0;

      consumer.on("fuel.issue.created", async () => {
        executionCount++;
      });

      const envelope: KafkaEventEnvelope = {
        id: "repeat-event-uuid-1",
        eventType: "FuelIssued",
        topic: KAFKA_TOPICS.FUEL_ISSUE_CREATED,
        key: "veh-1",
        timestamp: new Date().toISOString(),
        headers: { source: "fuel-system-v3", schemaVersion: "1.0.0" },
        payload: { issueId: "i-1" },
      };

      const rawMsg = {
        topic: KAFKA_TOPICS.FUEL_ISSUE_CREATED,
        key: "veh-1",
        value: JSON.stringify(envelope),
        publishedAt: Date.now(),
      };

      // First delivery: should process
      const firstResult = await consumer.handleMessage(rawMsg);
      expect(firstResult).toBe(true);
      expect(executionCount).toBe(1);

      // Second delivery (redelivery/duplicate): should be deduplicated
      const secondResult = await consumer.handleMessage(rawMsg);
      expect(secondResult).toBe(false);
      expect(executionCount).toBe(1); // Did not execute handler again

      const stats = consumer.getStats();
      expect(stats.messagesReceived).toBe(2);
      expect(stats.messagesProcessed).toBe(1);
      expect(stats.messagesDeduplicated).toBe(1);
    });
  });
});
