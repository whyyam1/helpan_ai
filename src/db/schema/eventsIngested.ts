/**
 * `events_ingested` — events published by consuming apps for the matching
 * engine to evaluate against active briefings.
 * ERD §1.7.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

export const eventsIngested = pgTable(
  'events_ingested',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    appId: text('app_id').notNull(),
    accountUuid: text('account_uuid'),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    matchStatus: text('match_status').notNull().default('pending'),
    matchCount: integer('match_count').notNull().default(0),
    appCorrelationId: text('app_correlation_id'),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('events_ingested_idempotency_uniq').on(
      t.idempotencyKey,
      t.appId
    ),
    typeAppIngestedIdx: index('events_ingested_type_app_ingested_idx').on(
      t.eventType,
      t.appId,
      t.ingestedAt.desc()
    ),
    pendingIdx: index('events_ingested_pending_idx')
      .on(t.matchStatus, t.ingestedAt)
      .where(sql`${t.matchStatus} = 'pending'`),
    matchStatusCheck: check(
      'events_ingested_match_status_chk',
      sql`${t.matchStatus} IN ('pending', 'matched', 'no_match', 'dlq')`
    ),
  })
);

export type EventIngestedRow = typeof eventsIngested.$inferSelect;
export type EventIngestedInsert = typeof eventsIngested.$inferInsert;
