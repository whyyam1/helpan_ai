/**
 * `kafka_outbox` — durable producer queue (H-17). ERD addition; RECAP §6.7.
 *
 * Producers INSERT inside the same tx that writes the business state, so
 * "event emitted" commits or rolls back atomically with "row written." The
 * drainer (src/workers/kafkaOutbox/) polls `status='pending'` with
 * FOR UPDATE SKIP LOCKED and publishes to Kafka.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const kafkaOutbox = pgTable(
  'kafka_outbox',
  {
    id: text('id').primaryKey(),
    topic: text('topic').notNull(),
    partitionKey: text('partition_key').notNull(),
    payload: jsonb('payload').notNull(),
    headers: jsonb('headers'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingIdx: index('kafka_outbox_pending_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    topicStatusIdx: index('kafka_outbox_topic_status_created_idx').on(
      t.topic,
      t.status,
      t.createdAt.desc()
    ),
    statusCheck: check(
      'kafka_outbox_status_chk',
      sql`${t.status} IN ('pending', 'delivered', 'abandoned')`
    ),
  })
);

export type KafkaOutboxRow = typeof kafkaOutbox.$inferSelect;
export type KafkaOutboxInsert = typeof kafkaOutbox.$inferInsert;
