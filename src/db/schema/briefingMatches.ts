/**
 * `briefing_matches` — events that matched a briefing.
 * ERD §1.8. Each row is one (briefing × event) tuple; an event can match
 * multiple briefings (one per row).
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { briefings } from './briefings.js';
import { eventsIngested } from './eventsIngested.js';

export const briefingMatches = pgTable(
  'briefing_matches',
  {
    id: text('id').primaryKey(),
    briefingId: text('briefing_id')
      .notNull()
      .references(() => briefings.id),
    eventId: text('event_id')
      .notNull()
      .references(() => eventsIngested.id),
    accountUuid: text('account_uuid').notNull(),
    matchConfidence: text('match_confidence').notNull(),
    matchDetail: jsonb('match_detail'),
    webhookDeliveryId: text('webhook_delivery_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    briefingCreatedIdx: index('briefing_matches_briefing_created_idx').on(
      t.briefingId,
      t.createdAt.desc()
    ),
    accountCreatedIdx: index('briefing_matches_account_created_idx').on(
      t.accountUuid,
      t.createdAt.desc()
    ),
    eventIdx: index('briefing_matches_event_idx').on(t.eventId),
    confidenceCheck: check(
      'briefing_matches_confidence_chk',
      sql`${t.matchConfidence} IN ('high', 'medium', 'low')`
    ),
  })
);

export type BriefingMatchRow = typeof briefingMatches.$inferSelect;
export type BriefingMatchInsert = typeof briefingMatches.$inferInsert;
