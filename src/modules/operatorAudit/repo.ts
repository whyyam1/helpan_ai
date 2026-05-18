/**
 * Drizzle data-access for the audit log query.
 *
 * The table has RLS enabled with `operator-only` SELECT policy (migration
 * 0006). Operator endpoints connect without setting the user GUC so the
 * `app.role` GUC is set to `'operator'` here for the duration of the query
 * — without this the RLS policy denies every row even for admin callers.
 */

import { and, desc, eq, gte, lte, lt, or, type SQL } from 'drizzle-orm';
import { sql as drizzleSql } from 'drizzle-orm';
import { auditLog } from '../../db/schema/auditLog.js';
import type { Db } from '../../db/client.js';
import type { ActorType, Outcome } from './schemas.js';

export interface AuditLogRow {
  id: string;
  appId: string | null;
  actorType: ActorType;
  actorId: string;
  agentId: string | null;
  delegatedAuthorityJti: string | null;
  initiatedBy: 'human' | 'agent' | 'system' | null;
  accountUuid: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  targetRail: 'kipkiren_pay' | 'identiti' | 'todoku' | null;
  targetOperation: string | null;
  requestId: string;
  traceparent: string | null;
  outcome: Outcome;
  detail: Record<string, unknown> | null;
  previousHash: string | null;
  entryHash: string;
  createdAt: Date;
}

export interface ListAuditInput {
  accountUuid?: string;
  agentId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  cursorCreatedAt?: Date;
  cursorId?: string;
  limit: number;
}

export async function listAuditEntries(
  db: Db,
  input: ListAuditInput
): Promise<readonly AuditLogRow[]> {
  // RLS: operator role required by migration 0006 policy. Set inside the
  // same transaction as the SELECT so the GUC scopes to this query only.
  return db.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT set_config('app.role', 'operator', true)`);

    const filters: SQL[] = [];
    if (input.accountUuid) filters.push(eq(auditLog.accountUuid, input.accountUuid));
    if (input.agentId) filters.push(eq(auditLog.agentId, input.agentId));
    if (input.action) filters.push(eq(auditLog.action, input.action));
    if (input.from) filters.push(gte(auditLog.createdAt, input.from));
    if (input.to) filters.push(lte(auditLog.createdAt, input.to));
    if (input.cursorCreatedAt && input.cursorId) {
      // Strict (created_at, id) descending cursor — prefer rows strictly
      // older than the cursor, with ties broken on id descending.
      const ltCreated = lt(auditLog.createdAt, input.cursorCreatedAt);
      const eqCreatedLtId = and(
        eq(auditLog.createdAt, input.cursorCreatedAt),
        lt(auditLog.id, input.cursorId)
      ) as SQL;
      filters.push(or(ltCreated, eqCreatedLtId) as SQL);
    }

    const rows = (await tx
      .select()
      .from(auditLog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(input.limit)) as unknown as AuditLogRow[];
    return rows;
  });
}
