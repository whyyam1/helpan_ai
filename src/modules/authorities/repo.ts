/**
 * Drizzle data-access for `delegated_authorities` + `authority_usage`.
 *
 * RLS note: `delegated_authorities` has RLS enabled (migration 0006) with a
 * SELECT-only `authorities_user_read` policy that stays dormant until H-8
 * wires customer-JWT Console reads. H-3's issue/validate/revoke run under
 * HMAC/system context (no `app.account_uuid` GUC) — the table is not FORCEd,
 * so the owner connection is RLS-exempt. See RECAP §6 for why no H-3
 * migration completes the write-policy set.
 *
 * `Tx` is accepted where the caller wants the row write + audit append in
 * one transaction.
 */

import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { delegatedAuthorities } from '../../db/schema/delegatedAuthorities.js';
import { authorityUsage } from '../../db/schema/authorityUsage.js';
import type { Db } from '../../db/client.js';
import type { Tx } from '../../plugins/rlsContext.js';
import type { AuthorityScopeDto, AuthorityStatus, RevocationReason } from './schemas.js';

export interface DelegatedAuthorityRow {
  id: string;
  accountUuid: string;
  agentId: string;
  scopes: AuthorityScopeDto[];
  status: AuthorityStatus;
  stepUpJti: string | null;
  issuedByAppId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  revocationDetail: string | null;
}

export interface InsertAuthorityInput {
  id: string;
  accountUuid: string;
  agentId: string;
  scopes: AuthorityScopeDto[];
  stepUpJti?: string | null;
  issuedByAppId: string;
  expiresAt: Date;
}

type DbOrTx = Db | Tx;

export async function insertAuthority(
  db: DbOrTx,
  input: InsertAuthorityInput
): Promise<DelegatedAuthorityRow> {
  const rows = (await db
    .insert(delegatedAuthorities)
    .values({
      id: input.id,
      accountUuid: input.accountUuid,
      agentId: input.agentId,
      scopes: input.scopes,
      status: 'active',
      stepUpJti: input.stepUpJti ?? null,
      issuedByAppId: input.issuedByAppId,
      expiresAt: input.expiresAt,
    })
    .returning()) as unknown as DelegatedAuthorityRow[];
  if (rows.length !== 1) throw new Error('insertAuthority: expected one row');
  return rows[0]!;
}

export async function getAuthorityById(
  db: DbOrTx,
  id: string
): Promise<DelegatedAuthorityRow | null> {
  const rows = (await db
    .select()
    .from(delegatedAuthorities)
    .where(eq(delegatedAuthorities.id, id))
    .limit(1)) as unknown as DelegatedAuthorityRow[];
  return rows[0] ?? null;
}

export interface ListAuthoritiesInput {
  status?: AuthorityStatus;
  agentId?: string;
  accountUuid?: string;
  cursorIssuedAt?: Date;
  cursorId?: string;
  limit: number;
}

export async function listAuthorities(
  db: Db,
  input: ListAuthoritiesInput
): Promise<readonly DelegatedAuthorityRow[]> {
  const filters: SQL[] = [];
  if (input.status) filters.push(eq(delegatedAuthorities.status, input.status));
  if (input.agentId) filters.push(eq(delegatedAuthorities.agentId, input.agentId));
  if (input.accountUuid) filters.push(eq(delegatedAuthorities.accountUuid, input.accountUuid));
  if (input.cursorIssuedAt && input.cursorId) {
    const ltIssued = lt(delegatedAuthorities.issuedAt, input.cursorIssuedAt);
    const eqIssuedLtId = and(
      eq(delegatedAuthorities.issuedAt, input.cursorIssuedAt),
      lt(delegatedAuthorities.id, input.cursorId)
    ) as SQL;
    filters.push(or(ltIssued, eqIssuedLtId) as SQL);
  }
  const rows = (await db
    .select()
    .from(delegatedAuthorities)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(delegatedAuthorities.issuedAt), desc(delegatedAuthorities.id))
    .limit(input.limit)) as unknown as DelegatedAuthorityRow[];
  return rows;
}

export interface RevokeAuthorityPatch {
  reason: RevocationReason;
  detail?: string | null;
  revokedAt: Date;
}

/**
 * Conditional revoke — only flips a row that is currently `active`. Returns
 * the updated row, or null when no active row matched (caller reads the
 * current row to disambiguate not-found / already-revoked / expired).
 */
export async function revokeActiveAuthority(
  db: DbOrTx,
  id: string,
  patch: RevokeAuthorityPatch
): Promise<DelegatedAuthorityRow | null> {
  const rows = (await db
    .update(delegatedAuthorities)
    .set({
      status: 'revoked',
      revokedAt: patch.revokedAt,
      revocationReason: patch.reason,
      revocationDetail: patch.detail ?? null,
    })
    .where(
      and(eq(delegatedAuthorities.id, id), eq(delegatedAuthorities.status, 'active'))
    )
    .returning()) as unknown as DelegatedAuthorityRow[];
  return rows[0] ?? null;
}

/**
 * Sum cumulative spend for one authority+scope within a period window.
 * `authority_usage` is written by the H-4 dispatch path; at H-3 it is empty,
 * so the period-limit check in validation always sees 0.
 */
export async function getPeriodUsageMinor(
  db: Db,
  authorityId: string,
  scopeId: string,
  periodWindow: string
): Promise<bigint> {
  const rows = (await db
    .select({ cumulative: authorityUsage.cumulativeMinor })
    .from(authorityUsage)
    .where(
      and(
        eq(authorityUsage.authorityId, authorityId),
        eq(authorityUsage.scopeId, scopeId),
        eq(authorityUsage.periodWindow, periodWindow)
      )
    )
    .limit(1)) as unknown as { cumulative: bigint }[];
  return rows[0]?.cumulative ?? 0n;
}
