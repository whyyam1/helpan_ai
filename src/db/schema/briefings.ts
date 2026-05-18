/**
 * `briefings` — standing user intents that the agent acts on.
 * ERD §1.3.
 *
 * `account_uuid` is a thin foreign reference to Identiti's authoritative
 * accounts table; we do not duplicate the user record here.
 *
 * `intent` is structured per app and per briefing_type — the schema for
 * intent objects lives in helpan-ai-per-app-integration-patterns-v1.md.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const briefings = pgTable(
  'briefings',
  {
    id: text('id').primaryKey(),
    accountUuid: text('account_uuid').notNull(),
    appId: text('app_id').notNull(),
    agentId: text('agent_id').references(() => agents.id),
    briefingType: text('briefing_type').notNull(),
    status: text('status').notNull().default('active'),
    intent: jsonb('intent').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    appCorrelationId: text('app_correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    accountStatusIdx: index('briefings_account_uuid_status_idx').on(t.accountUuid, t.status),
    appStatusIdx: index('briefings_app_id_status_idx').on(t.appId, t.status),
    agentIdx: index('briefings_agent_id_idx')
      .on(t.agentId)
      .where(sql`${t.agentId} IS NOT NULL`),
    typeStatusExpiryIdx: index('briefings_type_status_expiry_idx').on(
      t.briefingType,
      t.status,
      t.expiresAt
    ),
    typeCheck: check(
      'briefings_type_chk',
      sql`${t.briefingType} IN ('alert', 'standing_basket', 'scheduled_action', 'threshold_watch')`
    ),
    statusCheck: check(
      'briefings_status_chk',
      sql`${t.status} IN ('active', 'paused', 'expired', 'revoked')`
    ),
  })
);

export type BriefingRow = typeof briefings.$inferSelect;
export type BriefingInsert = typeof briefings.$inferInsert;
