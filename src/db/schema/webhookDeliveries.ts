/**
 * `webhook_deliveries` — at-least-once delivery state for outbound webhooks
 * to consuming apps (e.g. BRIEFING_MATCHED fan-out from H-5).
 * ERD §1.12.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull(),
    eventType: text('event_type').notNull(),
    eventId: text('event_id').notNull(),
    payload: jsonb('payload').notNull(),
    targetUrl: text('target_url').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appStatusNextIdx: index('webhook_deliveries_app_status_next_idx').on(
      t.appId,
      t.status,
      t.nextAttemptAt
    ),
    statusCheck: check(
      'webhook_deliveries_status_chk',
      sql`${t.status} IN ('pending', 'delivered', 'abandoned')`
    ),
  })
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert;
