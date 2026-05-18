/**
 * `kafka_offsets` — per consumer-group offset tracking.
 * ERD §1.14. Used when Helpan AI starts consuming Identiti / KP / Todoku
 * topics (H-3 onwards). Created empty in H-1.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const kafkaOffsets = pgTable(
  'kafka_offsets',
  {
    consumerGroup: text('consumer_group').notNull(),
    topic: text('topic').notNull(),
    partition: integer('partition').notNull(),
    offsetCommitted: bigint('offset_committed', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.consumerGroup, t.topic, t.partition] }),
  })
);

export type KafkaOffsetRow = typeof kafkaOffsets.$inferSelect;
export type KafkaOffsetInsert = typeof kafkaOffsets.$inferInsert;
