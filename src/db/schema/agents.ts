/**
 * `agents` — registered agents (one per consuming app, plus third-party).
 * ERD §1.1.
 *
 * `agent_class` distinguishes:
 *   - portfolio_app:      a Kirimon-portfolio app's branded Helpan agent
 *   - third_party_oauth:  external agent connected via Identiti OAuth
 *   - internal_system:    KMV-internal automation
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    agentClass: text('agent_class').notNull(),
    ownerAppId: text('owner_app_id'),
    thirdPartyOauthClientId: text('third_party_oauth_client_id'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => ({
    classStatusIdx: index('agents_class_status_idx').on(t.agentClass, t.status),
    ownerAppIdx: index('agents_owner_app_id_idx')
      .on(t.ownerAppId)
      .where(sql`${t.ownerAppId} IS NOT NULL`),
    thirdPartyClientIdx: uniqueIndex('agents_third_party_oauth_client_id_uniq')
      .on(t.thirdPartyOauthClientId)
      .where(sql`${t.thirdPartyOauthClientId} IS NOT NULL`),
    classCheck: check(
      'agents_class_chk',
      sql`${t.agentClass} IN ('portfolio_app', 'third_party_oauth', 'internal_system')`
    ),
    statusCheck: check(
      'agents_status_chk',
      sql`${t.status} IN ('active', 'suspended', 'retired')`
    ),
  })
);

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = typeof agents.$inferInsert;
