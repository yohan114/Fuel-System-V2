// ============================================================================
// Phase 14 & 15 — Kafka Event Topics & CloudEvents Envelope Router
// Reference: Fuel-System-V3 Plan Section 20 (Phase 15 — Kafka Event Architecture)
//
// Defines canonical Kafka enterprise topics, partition key strategies,
// and standard CloudEvents-compliant message envelope serialization.
// ============================================================================

import type { OutboxRecord } from "@/lib/worker/types";

export const KAFKA_TOPICS = {
  FUEL_ISSUE_CREATED: "fuel.issue.created",
  FUEL_ISSUE_VOIDED: "fuel.issue.voided",
  FUEL_REQUEST_APPROVED: "fuel.request.approved",
  BILLING_INVOICE_GENERATED: "billing.invoice.generated",
  BILLING_PAYMENT_RECEIVED: "billing.payment.received",
  ASSET_METER_UPDATED: "asset.meter.updated",
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

/**
 * Standard CloudEvents-compliant Kafka message envelope
 */
export interface KafkaEventEnvelope<T = any> {
  id: string; // Unique Outbox UUID
  eventType: string; // e.g. "FuelIssued"
  topic: string; // e.g. "fuel.issue.created"
  key: string; // Aggregate ID (Asset / Tank ID) for strict partition ordering
  timestamp: string; // ISO 8601 UTC timestamp
  headers: {
    source: string;
    schemaVersion: string;
    correlationId?: string;
    tenantId?: string;
  };
  payload: T;
}

/**
 * Declarative mapping from internal domain event types to enterprise Kafka topics
 */
export const EVENT_TOPIC_MAP: Record<string, string> = {
  FuelIssued: KAFKA_TOPICS.FUEL_ISSUE_CREATED,
  FuelVoided: KAFKA_TOPICS.FUEL_ISSUE_VOIDED,
  FuelRequestApproved: KAFKA_TOPICS.FUEL_REQUEST_APPROVED,
  BillFinalized: KAFKA_TOPICS.BILLING_INVOICE_GENERATED,
  BillGenerated: KAFKA_TOPICS.BILLING_INVOICE_GENERATED,
  PaymentReceived: KAFKA_TOPICS.BILLING_PAYMENT_RECEIVED,
  MeterReadingLogged: KAFKA_TOPICS.ASSET_METER_UPDATED,
};

/**
 * Resolves the target Kafka topic for a domain event type.
 * Returns null if the event is strictly internal and should not be egressed.
 */
export function resolveKafkaTopic(eventType: string): string | null {
  return EVENT_TOPIC_MAP[eventType] || null;
}

/**
 * Constructs a CloudEvents-compliant Kafka message envelope from an outbox record.
 */
export function buildKafkaEnvelope(record: OutboxRecord): KafkaEventEnvelope {
  const topic = resolveKafkaTopic(record.eventType) || "events.generic";
  let parsedPayload: any;

  try {
    parsedPayload = JSON.parse(record.payloadJson);
  } catch {
    parsedPayload = { raw: record.payloadJson };
  }

  return {
    id: record.id,
    eventType: record.eventType,
    topic,
    key: record.aggregateId || record.id, // Partition key ensures ordering per asset/tank
    timestamp: record.createdAt instanceof Date ? record.createdAt.toISOString() : new Date().toISOString(),
    headers: {
      source: "fuel-system-v3",
      schemaVersion: "1.0.0",
      correlationId: record.id,
    },
    payload: parsedPayload,
  };
}
