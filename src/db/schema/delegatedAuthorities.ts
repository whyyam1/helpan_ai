/**
 * `delegated_authorities` — issued delegated authority tokens.
 * ERD §1.4. The most security-critical table in the rail.
 *
 * `id` is the JWT `jti` claim (RS256 signed by Identiti on Helpan AI's
 * behalf per the H4 joint contract). The token itself is not stored;
 * only its metadata. Validation against this table is the most-called
 * code path by relying parties (KP, Todoku, consuming-app servers).
 *
 * `step_up_jti` records the step-up token consumed at issuance time for
 * high-stakes scopes. Audit-trail evidence; not used for re-validation.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const delegatedAuthorities = pgTable(
  'delegated_authorities',
  {
    id: text('id').primaryKey(),
    accountUuid: text('account_uuid').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    scopes: jsonb('scopes').notNull(),
    status: text('status').notNull().default('active'),
    stepUpJti: text('step_up_jti'),
    issuedByAppId: text('issued_by_app_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    revocationDetail: text('revocation_detail'),
  },
  (t) => ({
    accountStatusIdx: index('delegated_authorities_account_status_idx').on(
      t.accountUuid,
      t.status
    ),
    agentStatusIdx: index('delegated_authorities_agent_status_idx').on(t.agentId, t.status),
    statusExpiryIdx: index('delegated_authorities_status_expiry_idx').on(t.status, t.expiresAt),
    stepUpJtiIdx: index('delegated_authorities_step_up_jti_idx')
      .on(t.stepUpJti)
      .where(sql`${t.stepUpJti} IS NOT NULL`),
    statusCheck: check(
      'delegated_authorities_status_chk',
      sql`${t.status} IN ('active', 'expired', 'revoked')`
    ),
    revocationReasonCheck: check(
      'delegated_authorities_reason_chk',
      sql`${t.revocationReason} IS NULL OR ${t.revocationReason} IN (
        'user_initiated', 'operator_initiated', 'account_suspended',
        'kyc_downgraded', 'cascade_user_deleted', 'cascade_consent_revoked',
        'security_incident', 'expired', 'other'
      )`
    ),
  })
);

export type DelegatedAuthorityRow = typeof delegatedAuthorities.$inferSelect;
export type DelegatedAuthorityInsert = typeof delegatedAuthorities.$inferInsert;
