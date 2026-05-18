/**
 * `authority_usage` — per-period cumulative usage for `per_period_limit_minor`
 * enforcement on AuthorityScope objects.
 * ERD §1.5.
 *
 * `period_window` is a date key (daily / weekly / monthly window normalised
 * by the validate path).
 */

import {
  pgTable,
  text,
  bigint,
  integer,
  date,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { delegatedAuthorities } from './delegatedAuthorities.js';
import { oauthScopes } from './oauthScopes.js';

export const authorityUsage = pgTable(
  'authority_usage',
  {
    authorityId: text('authority_id')
      .notNull()
      .references(() => delegatedAuthorities.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => oauthScopes.id),
    periodWindow: date('period_window').notNull(),
    cumulativeMinor: bigint('cumulative_minor', { mode: 'bigint' }).notNull().default(0n),
    callCount: integer('call_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.authorityId, t.scopeId, t.periodWindow] }),
  })
);

export type AuthorityUsageRow = typeof authorityUsage.$inferSelect;
export type AuthorityUsageInsert = typeof authorityUsage.$inferInsert;
