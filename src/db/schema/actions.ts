/**
 * `actions` — every agent action attempted via dispatch.
 * ERD §1.6.
 *
 * Payload columns are redacted at the dispatch layer — no PII, no full PANs,
 * no plaintext phone numbers. The audit trail in `audit_log` is the
 * authoritative compliance record; this table is the operational state.
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
import { agents } from './agents.js';
import { delegatedAuthorities } from './delegatedAuthorities.js';

export const actions = pgTable(
  'actions',
  {
    id: text('id').primaryKey(),
    accountUuid: text('account_uuid').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    delegatedAuthorityJti: text('delegated_authority_jti').references(
      () => delegatedAuthorities.id
    ),
    targetRail: text('target_rail').notNull(),
    targetOperation: text('target_operation').notNull(),
    status: text('status').notNull().default('pending'),
    initiatedBy: text('initiated_by').notNull(),
    actorType: text('actor_type'),
    requestPayloadRedacted: jsonb('request_payload_redacted').notNull(),
    resultRedacted: jsonb('result_redacted'),
    errorCode: text('error_code'),
    traceparent: text('traceparent'),
    appId: text('app_id').notNull(),
    appCorrelationId: text('app_correlation_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('actions_idempotency_uniq').on(t.idempotencyKey, t.appId),
    accountCreatedIdx: index('actions_account_created_idx').on(
      t.accountUuid,
      t.createdAt.desc()
    ),
    agentCreatedIdx: index('actions_agent_created_idx').on(t.agentId, t.createdAt.desc()),
    daaJtiIdx: index('actions_daa_jti_idx')
      .on(t.delegatedAuthorityJti)
      .where(sql`${t.delegatedAuthorityJti} IS NOT NULL`),
    railOpStatusIdx: index('actions_rail_op_status_idx').on(
      t.targetRail,
      t.targetOperation,
      t.status
    ),
    pendingIdx: index('actions_pending_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    targetRailCheck: check(
      'actions_target_rail_chk',
      sql`${t.targetRail} IN ('kipkiren_pay', 'identiti', 'todoku')`
    ),
    statusCheck: check(
      'actions_status_chk',
      sql`${t.status} IN ('pending', 'completed', 'failed')`
    ),
    initiatedByCheck: check(
      'actions_initiated_by_chk',
      sql`${t.initiatedBy} IN ('human', 'agent', 'system')`
    ),
    actorTypeCheck: check(
      'actions_actor_type_chk',
      sql`${t.actorType} IS NULL OR ${t.actorType} IN ('human', 'agent')`
    ),
  })
);

export type ActionRow = typeof actions.$inferSelect;
export type ActionInsert = typeof actions.$inferInsert;
