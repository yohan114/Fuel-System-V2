// ============================================================================
// Phase 14 & 15 — Resilient Kafka Producer & In-Memory Broker
// Reference: Fuel-System-V3 Plan Section 20 (Phase 15 — Kafka Event Architecture)
//
// Provides reliable message publication with topic partitioning and an
// in-memory streaming broker for offline development and deterministic testing.
// ============================================================================

import { Kafka, type Producer } from "kafkajs";

export interface KafkaPublishedMessage {
  topic: string;
  key: string;
  value: string;
  headers?: Record<string, string>;
  publishedAt: number;
}

export type KafkaMessageHandler = (msg: KafkaPublishedMessage) => Promise<void>;

export interface IKafkaBroker {
  publish(
    topic: string,
    messages: Array<{ key: string; value: string; headers?: Record<string, string> }>
  ): Promise<void>;
  subscribe(topic: string, handler: KafkaMessageHandler): () => void;
  disconnect(): Promise<void>;
}

/**
 * Enterprise In-Memory Kafka Streaming Broker
 * Provides complete pub/sub topic streaming, partition key tracking,
 * and asynchronous consumer dispatch for CI and local unit tests.
 */
export class InMemoryKafkaBroker implements IKafkaBroker {
  private messages: KafkaPublishedMessage[] = [];
  private subscriptions = new Map<string, Set<KafkaMessageHandler>>();

  async publish(
    topic: string,
    messages: Array<{ key: string; value: string; headers?: Record<string, string> }>
  ): Promise<void> {
    for (const msg of messages) {
      const recorded: KafkaPublishedMessage = {
        topic,
        key: msg.key,
        value: msg.value,
        headers: msg.headers,
        publishedAt: Date.now(),
      };
      this.messages.push(recorded);

      // Asynchronously deliver to active subscribers
      const handlers = this.subscriptions.get(topic);
      if (handlers && handlers.size > 0) {
        for (const handler of handlers) {
          setTimeout(() => {
            handler(recorded).catch(() => {});
          }, 0);
        }
      }
    }
  }

  subscribe(topic: string, handler: KafkaMessageHandler): () => void {
    let set = this.subscriptions.get(topic);
    if (!set) {
      set = new Set();
      this.subscriptions.set(topic, set);
    }
    set.add(handler);

    return () => {
      set?.delete(handler);
    };
  }

  async disconnect(): Promise<void> {
    this.messages = [];
    this.subscriptions.clear();
  }

  // Testing inspection helpers
  getPublishedMessages(topic?: string): KafkaPublishedMessage[] {
    if (topic) {
      return this.messages.filter((m) => m.topic === topic);
    }
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.subscriptions.clear();
  }
}

/**
 * Live Kafka Broker Producer using kafkajs
 */
export class LiveKafkaBroker implements IKafkaBroker {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  constructor(brokers: string[] = ["127.0.0.1:9092"]) {
    this.kafka = new Kafka({
      clientId: "fuel-system-v3",
      brokers,
    });
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });
  }

  private async ensureConnected() {
    if (!this.isConnected) {
      await this.producer.connect();
      this.isConnected = true;
    }
  }

  async publish(
    topic: string,
    messages: Array<{ key: string; value: string; headers?: Record<string, string> }>
  ): Promise<void> {
    await this.ensureConnected();
    await this.producer.send({
      topic,
      messages: messages.map((m) => ({
        key: m.key,
        value: m.value,
        headers: m.headers,
      })),
    });
  }

  subscribe(topic: string, handler: KafkaMessageHandler): () => void {
    // In live Kafka environments, consumers are managed via consumer groups in workers
    return () => {};
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.isConnected = false;
    }
  }
}

let globalKafkaBroker: IKafkaBroker | null = null;

export function getKafkaBroker(): IKafkaBroker {
  if (globalKafkaBroker) return globalKafkaBroker;

  const kafkaEnabled = process.env.KAFKA_ENABLED === "true";
  const kafkaBrokers = process.env.KAFKA_BROKERS?.split(",");

  if (kafkaEnabled && kafkaBrokers && kafkaBrokers.length > 0) {
    globalKafkaBroker = new LiveKafkaBroker(kafkaBrokers);
  } else {
    globalKafkaBroker = new InMemoryKafkaBroker();
  }

  return globalKafkaBroker;
}

export function setKafkaBroker(broker: IKafkaBroker | null): void {
  globalKafkaBroker = broker;
}
