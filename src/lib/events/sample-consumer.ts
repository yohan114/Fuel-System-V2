// ============================================================================
// Phase 14 & 15 — Reference Kafka Consumer Pipeline
// Reference: Fuel-System-V3 Plan Section 20 (Phase 15 — Kafka Event Architecture)
//
// Demonstrates resilient topic consumption, CloudEvents envelope parsing,
// and idempotent deduplication via IdempotentConsumerRegistry.
// ============================================================================

import type { IKafkaBroker, KafkaPublishedMessage } from "./kafka-producer";
import { getKafkaBroker } from "./kafka-producer";
import { KAFKA_TOPICS, type KafkaEventEnvelope } from "./topic-router";
import {
  IdempotentConsumerRegistry,
  defaultConsumerRegistry,
} from "@/lib/worker/idempotent-consumer";

export interface ConsumerStats {
  messagesReceived: number;
  messagesProcessed: number;
  messagesDeduplicated: number;
  errorsCount: number;
}

export type DomainEventHandler<T = any> = (
  envelope: KafkaEventEnvelope<T>
) => Promise<void>;

export class EnterpriseEventConsumer {
  private unsubscribeFns: Array<() => void> = [];
  private handlers = new Map<string, DomainEventHandler>();
  private stats: ConsumerStats = {
    messagesReceived: 0,
    messagesProcessed: 0,
    messagesDeduplicated: 0,
    errorsCount: 0,
  };

  constructor(
    public readonly consumerName: string = "EnterpriseEventConsumer",
    private broker: IKafkaBroker = getKafkaBroker(),
    private registry: IdempotentConsumerRegistry = defaultConsumerRegistry
  ) {}

  /**
   * Registers a domain event handler for a specific Kafka topic or eventType.
   */
  public on<T = any>(topicOrType: string, handler: DomainEventHandler<T>): this {
    this.handlers.set(topicOrType, handler);
    return this;
  }

  /**
   * Starts listening to specified Kafka topics.
   */
  public start(topics: string[] = Object.values(KAFKA_TOPICS)): void {
    this.stop(); // Clean up existing subscriptions if any

    for (const topic of topics) {
      const unsub = this.broker.subscribe(topic, async (msg: KafkaPublishedMessage) => {
        await this.handleMessage(msg);
      });
      this.unsubscribeFns.push(unsub);
    }
  }

  /**
   * Stops listening to Kafka topics and detaches all active handlers.
   */
  public stop(): void {
    for (const unsub of this.unsubscribeFns) {
      unsub();
    }
    this.unsubscribeFns = [];
  }

  /**
   * Internal message processor executing idempotent deduplication and dispatch.
   */
  public async handleMessage(msg: KafkaPublishedMessage): Promise<boolean> {
    this.stats.messagesReceived++;

    let envelope: KafkaEventEnvelope;
    try {
      envelope = JSON.parse(msg.value);
    } catch {
      this.stats.errorsCount++;
      return false;
    }

    const messageId = envelope.id || `${msg.topic}-${msg.key}-${msg.publishedAt}`;
    const eventType = envelope.eventType || "Unknown";

    // Idempotent execution guard
    const alreadyProcessed = await this.registry.hasProcessed(this.consumerName, messageId);
    if (alreadyProcessed) {
      this.stats.messagesDeduplicated++;
      return false;
    }

    try {
      // Find matching handler by topic or eventType
      const handler = this.handlers.get(msg.topic) || this.handlers.get(eventType);
      if (handler) {
        await handler(envelope);
      }

      await this.registry.markProcessed(this.consumerName, messageId, eventType);
      this.stats.messagesProcessed++;
      return true;
    } catch (err) {
      this.stats.errorsCount++;
      throw err;
    }
  }

  public getStats(): ConsumerStats {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      messagesReceived: 0,
      messagesProcessed: 0,
      messagesDeduplicated: 0,
      errorsCount: 0,
    };
  }
}
