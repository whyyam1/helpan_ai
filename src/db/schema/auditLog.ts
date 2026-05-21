/**
 * `audit_log` — append-only, hash-chained, 7-year retention.
 * ERD §1.13; Reboot Pack §9.5.
 *
 * Tamper-evident: each row's entry_hash = SHA-256(id + actor_id + action +
 * detail + previous_hash). The chain is seeded with a NULL-previous_hash
 * row inserted by migration 0001 so action #1 has a well-formed chain.
 *
 * RLS: operator-only read in v1 (see migration 0006).
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  inet,
  smallint,
  index,
  check,
} from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    appId: text('app_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    agentId: text('agent_id'),
    delegatedAuthorityJti: text('delegated_authority_jti'),
    initiatedBy: text('initiated_by'),
    accountUuid: text('account_uuid'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    targetRail: text('target_rail'),
    targetOperation: text('target_operation'),
    requestId: text('request_id').notNull(),
    traceparent: text('traceparent'),
    // Shared cross-rail business-operation id (§A.11). Added by migration 0009.
    businessOpId: text('business_op_id'),
    ipAddress: inet('ip_address'),
    outcome: text('outcome').notNull(),
    detail: jsonb('detail'),
    previousHash: text('previous_hash'),
    entryHash: text('entry_hash').notNull(),
    // H-15: 1 = legacy composition (pre-H-15 rows incl. genesis);
    //       2 = current composition covering every persisted column.
    //       See src/lib/auditWriter.ts → computeEntryHashForVersion.
    hashVersion: smallint('hash_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appCreatedIdx: index('audit_log_app_id_created_at_idx').on(t.appId, t.createdAt.desc()),
    accountCreatedIdx: index('audit_log_account_uuid_created_at_idx').on(
      t.accountUuid,
      t.createdAt.desc()
    ),
    agentCreatedIdx: index('audit_log_agent_id_created_at_idx')
      .on(t.agentId, t.createdAt.desc())
      .where(sql`${t.agentId} IS NOT NULL`),
    daaCreatedIdx: index('audit_log_daa_jti_created_at_idx')
      .on(t.delegatedAuthorityJti, t.createdAt.desc())
      .where(sql`${t.delegatedAuthorityJti} IS NOT NULL`),
    actionCreatedIdx: index('audit_log_action_created_at_idx').on(
      t.action,
      t.createdAt.desc()
    ),
    railOpCreatedIdx: index('audit_log_rail_op_created_at_idx')
      .on(t.targetRail, t.targetOperation, t.createdAt.desc())
      .where(sql`${t.targetRail} IS NOT NULL`),
    actorTypeCheck: check(
      'audit_log_actor_type_chk',
      sql`${t.actorType} IN ('user', 'agent', 'operator', 'system')`
    ),
    initiatedByCheck: check(
      'audit_log_initiated_by_chk',
      sql`${t.initiatedBy} IS NULL OR ${t.initiatedBy} IN ('human', 'agent', 'system')`
    ),
    outcomeCheck: check(
      'audit_log_outcome_chk',
      sql`${t.outcome} IN ('success', 'failure')`
    ),
    hashVersionCheck: check(
      'audit_log_hash_version_chk',
      sql`${t.hashVersion} IN (1, 2)`
    ),
  })
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
