/**
 * Kafka producer surface.
 *
 * Two implementations:
 *   - `createKafkajsProducer(config)` — real producer, used in production, on
 *     Confluent's maintained `@confluentinc/kafka-javascript` through its
 *     KafkaJS-compatible API (kafkajs itself is unmaintained). Acks=all +
 *     idempotent so duplicates from broker-side retries are de-duplicated.
 *   - `createInMemoryProducer()` — captures publishes in an array. Used by
 *     unit and stub-DB integration tests so the rail can be exercised
 *     without a broker.
 *
 * The minimal surface is intentional: `publish(message)` and the lifecycle
 * pair `connect()` / `disconnect()`. Anything more would couple callers to
 * the client library's broader API.
 *
 * H-5 is the first user of this module. H-3 will reuse it for
 * `helpan.authority.events`; H-4 for `helpan.action.events`.
 */

import { KafkaJS } from '@confluentinc/kafka-javascript';
import { toKafkajsAuth, type KafkaAuth } from './connection.js';

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
  /** SASL / TLS for managed brokers — see `./connection.ts`. */
  readonly auth?: KafkaAuth;
}

export function createKafkajsProducer(config: KafkajsProducerConfig): KafkaProducerLike {
  const kafka = new KafkaJS.Kafka({
    kafkaJS: {
      clientId: config.clientId,
      brokers: [...config.brokers],
      logLevel: KafkaJS.logLevel.WARN,
      ...toKafkajsAuth(config.auth),
    },
  });
  const producer: KafkaJS.Producer = kafka.producer({
    kafkaJS: {
      allowAutoTopicCreation: false,
      idempotent: true,
      // acks=-1 (all) — survive single-broker loss per Event Bus Contract §1.1.
      // The Confluent client takes acks on the producer, never per send().
      acks: -1,
      // Partitioner: the client's fixed `murmur2_random` (Java-compatible).
      // Per-key ordering only needs one partitioner per topic, and every
      // helpan.* topic has exactly one producer — this rail.
    },
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
