/**
 * `oauth_scopes` — canonical catalogue of scopes Helpan AI defines.
 * Identiti is the issuer of the underlying OAuth token; Helpan AI is the
 * relying-party authority that defines what scopes mean and what they cap.
 *
 * ERD §1.2. Seeded from helpan-ai-oauth-scope-catalogue-v1.md by the
 * 0002 migration so the catalogue is part of the schema, not a runtime asset.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';

export const oauthScopes = pgTable(
  'oauth_scopes',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    rail: text('rail').notNull(),
    category: text('category').notNull(),
    defaultGrantable: boolean('default_grantable').notNull().default(true),
    elevationFriction: text('elevation_friction').notNull().default('low'),
    perScopeAmountCeilingMinor: bigint('per_scope_amount_ceiling_minor', { mode: 'bigint' }),
    perScopePeriodCeilingMinor: bigint('per_scope_period_ceiling_minor', { mode: 'bigint' }),
    perScopeMaxTtlSeconds: integer('per_scope_max_ttl_seconds').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    railStatusIdx: index('oauth_scopes_rail_status_idx').on(t.rail, t.status),
    railCheck: check(
      'oauth_scopes_rail_chk',
      sql`${t.rail} IN ('helpan', 'kipkiren_pay', 'identiti', 'todoku', 'lunchdrop', 'chapaa', 'klokd', 'family_discovery')`
    ),
    categoryCheck: check(
      'oauth_scopes_category_chk',
      sql`${t.category} IN ('read_aggregate', 'read_behavioural', 'write_money', 'write_comms', 'write_identity', 'admin')`
    ),
    elevationCheck: check(
      'oauth_scopes_elevation_chk',
      sql`${t.elevationFriction} IN ('low', 'medium', 'high')`
    ),
    statusCheck: check(
      'oauth_scopes_status_chk',
      sql`${t.status} IN ('active', 'deprecated', 'retired')`
    ),
  })
);

export type OauthScopeRow = typeof oauthScopes.$inferSelect;
export type OauthScopeInsert = typeof oauthScopes.$inferInsert;
