/**
 * Kafka producer surface.
 *
 * Two implementations:
 *   - `createKafkajsProducer(config)` — real `kafkajs` producer, used in
 *     production. Acks=all + idempotent so duplicates from broker-side
 *     retries are de-duplicated.
 *   - `createInMemoryProducer()` — captures publishes in an array. Used by
 *     unit and stub-DB integration tests so the rail can be exercised
 *     without a broker.
 *
 * The minimal surface is intentional: `publish(message)` and the lifecycle
 * pair `connect()` / `disconnect()`. Anything more would couple callers to
 * kafkajs's broader API.
 *
 * H-5 is the first user of this module. H-3 will reuse it for
 * `helpan.authority.events`; H-4 for `helpan.action.events`.
 */

import { Kafka, Partitioners, type Producer, logLevel } from 'kafkajs';

export interface KafkaMessage {
  readonly topic: string;
  /** Partition key — for account-scoped events, the Account UUID. */
  readonly key: string;
  /** JSON-serialisable body. */
  readonly value: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

export interface KafkaProducerLike {
  publish(message: KafkaMessage): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface KafkajsProducerConfig {
  readonly clientId: string;
  readonly brokers: readonly string[];
}

export function createKafkajsProducer(config: KafkajsProducerConfig): KafkaProducerLike {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: [...config.brokers],
    logLevel: logLevel.WARN,
  });
  const producer: Producer = kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true,
    // Default partitioner changed in kafkajs 2.x; pin to LegacyPartitioner so
    // hash(key) → partition is stable across runs and matches the Identiti /
    // KP / Todoku rails' partitioning.
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  return {
    async connect() {
      await producer.connect();
    },
    async disconnect() {
      await producer.disconnect();
    },
    async publish(message) {
      await producer.send({
        topic: message.topic,
        messages: [
          {
            key: message.key,
            value: JSON.stringify(message.value),
            ...(message.headers ? { headers: message.headers } : {}),
          },
        ],
        // acks=-1 (all) — survive single-broker loss per Event Bus Contract §1.1.
        acks: -1,
      });
    },
  };
}

export interface CapturedMessage {
  readonly topic: string;
  readonly key: string;
  readonly value: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly publishedAt: Date;
}

export interface InMemoryProducer extends KafkaProducerLike {
  readonly published: readonly CapturedMessage[];
  clear(): void;
}

export function createInMemoryProducer(): InMemoryProducer {
  const captured: CapturedMessage[] = [];
  return {
    get published() {
      return captured;
    },
    clear() {
      captured.length = 0;
    },
    async connect() {
      // no-op
    },
    async disconnect() {
      // no-op
    },
    async publish(message) {
      captured.push({
        topic: message.topic,
        key: message.key,
        value: message.value,
        ...(message.headers ? { headers: message.headers } : {}),
        publishedAt: new Date(),
      });
    },
  };
}
