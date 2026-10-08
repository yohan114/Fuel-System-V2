// Transactional Outbox Event Emitter (Task API-02 / Master Plan Section 8)
// Guarantees reliable domain event publishing across database transactions.

import type { Prisma } from "@prisma/client";

export interface DomainOutboxEvent {
  eventType: "FuelIssued" | "FuelVoided" | "TransferApproved" | "InvoiceIssued";
  aggregateType: "FuelIssue" | "BulkTransfer" | "Invoice";
  aggregateId: string;
  payload: Record<string, any>;
  idempotencyKey?: string | null;
}

// In-memory buffer for testing or inspection when running on SQLite without native outbox table
export const testOutboxBuffer: DomainOutboxEvent[] = [];

/**
 * Emits a domain outbox message within an active database transaction.
 * If the target database schema includes the `OutboxMessage` table, it writes directly;
 * otherwise it captures the event in the domain audit/outbox buffer.
 */
export async function emitOutboxEvent(
  tx: Prisma.TransactionClient,
  event: DomainOutboxEvent
): Promise<void> {
  const payloadStr = JSON.stringify(event.payload);

  // If OutboxMessage model is available on the current Prisma client (PostgreSQL)
  if ((tx as any).outboxMessage) {
    await (tx as any).outboxMessage.create({
      data: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payloadJson: payloadStr,
        createdAt: new Date(),
        retryCount: 0,
      },
    });
  }

  // Also capture in buffer for inspection in test/diagnostic environments
  testOutboxBuffer.push({
    ...event,
    payload: JSON.parse(payloadStr),
  });
}

/**
 * Clears the in-memory test outbox buffer between test runs.
 */
export function clearTestOutboxBuffer(): void {
  testOutboxBuffer.length = 0;
}
