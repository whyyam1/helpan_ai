/**
 * Drizzle data-access for `actions`.
 *
 * The actions table carries the rail's operational view of every agent
 * dispatch. The audit_log holds the authoritative tamper-evident record;
 * this table holds status + redacted payload + redacted result for
 * operational reads (Console Activity tab, operator debugging).
 *
 * Idempotency: every row carries the caller-supplied `idempotency_key`
 * with a UNIQUE index on (idempotency_key, app_id). The Fastify
 * idempotency plugin replays the cached HTTP response on retries; this
 * unique index is the DB backstop.
 */

import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { actions } from '../../db/schema/actions.js';
import type { Db } from '../../db/client.js';
import type { Tx } from '../../plugins/rlsContext.js';
import type {
  ActionInitiatedBy,
  ActionStatus,
  ActionTargetRail,
} from './schemas.js';

export interface ActionRow {
  id: string;
  accountUuid: string;
  agentId: string;
  delegatedAuthorityJti: string | null;
  targetRail: string;
  targetOperation: string;
  status: string;
  initiatedBy: string;
  actorType: string | null;
  requestPayloadRedacted: Record<string, unknown>;
  resultRedacted: Record<string, unknown> | null;
  errorCode: string | null;
  traceparent: string | null;
  appId: string;
  appCorrelationId: string | null;
  businessOpId: string | null;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface InsertActionInput {
  readonly id: string;
  readonly accountUuid: string;
  readonly agentId: string;
  readonly delegatedAuthorityJti: string;
  readonly targetRail: ActionTargetRail;
  readonly targetOperation: string;
  readonly initiatedBy: ActionInitiatedBy;
  readonly actorType: 'agent' | 'human';
  readonly requestPayloadRedacted: Record<string, unknown>;
  readonly traceparent: string;
  readonly appId: string;
  readonly appCorrelationId?: string | null;
  readonly businessOpId: string;
  readonly idempotencyKey: string;
}

export async function insertAction(tx: Tx, input: InsertActionInput): Promise<ActionRow> {
  const rows = (await tx
    .insert(actions)
    .values({
      id: input.id,
      accountUuid: input.accountUuid,
      agentId: input.agentId,
      delegatedAuthorityJti: input.delegatedAuthorityJti,
      targetRail: input.targetRail,
      targetOperation: input.targetOperation,
      status: 'pending',
      initiatedBy: input.initiatedBy,
      actorType: input.actorType,
      requestPayloadRedacted: input.requestPayloadRedacted,
      traceparent: input.traceparent,
      appId: input.appId,
      appCorrelationId: input.appCorrelationId ?? null,
      businessOpId: input.businessOpId,
      idempotencyKey: input.idempotencyKey,
    })
    .returning()) as unknown as ActionRow[];
  if (rows.length !== 1) throw new Error('insertAction: expected one row');
  return rows[0]!;
}

export async function markActionCompleted(
  tx: Tx,
  id: string,
  resultRedacted: Record<string, unknown>
): Promise<ActionRow | null> {
  const rows = (await tx
    .update(actions)
    .set({
      status: 'completed',
      resultRedacted,
      errorCode: null,
      completedAt: new Date(),
    })
    .where(eq(actions.id, id))
    .returning()) as unknown as ActionRow[];
  return rows[0] ?? null;
}

export async function markActionFailed(
  tx: Tx,
  id: string,
  errorCode: string,
  detail: Record<string, unknown> | undefined
): Promise<ActionRow | null> {
  const rows = (await tx
    .update(actions)
    .set({
      status: 'failed',
      resultRedacted: detail ?? null,
      errorCode,
      completedAt: new Date(),
    })
    .where(eq(actions.id, id))
    .returning()) as unknown as ActionRow[];
  return rows[0] ?? null;
}

export async function getActionById(db: Db, id: string): Promise<ActionRow | null> {
  const rows = (await db
    .select()
    .from(actions)
    .where(eq(actions.id, id))
    .limit(1)) as unknown as ActionRow[];
  return rows[0] ?? null;
}

export interface ListActionsInput {
  status?: ActionStatus;
  agentId?: string;
  targetRail?: ActionTargetRail;
  accountUuid?: string;
  cursorCreatedAt?: Date;
  cursorId?: string;
  limit: number;
}

/**
 * Reaper read path (H-16). Returns up to `limit` actions still in
 * `pending` whose `created_at` is older than the staleness threshold,
 * row-locked via `FOR UPDATE SKIP LOCKED` so concurrent reaper replicas
 * do not double-settle.
 *
 * MUST be called inside a transaction — the row locks are tx-scoped.
 * The caller settles each row via `markActionFailed` (writing the
 * `action.fail` audit entry inside the SAME transaction so the row
 * status and the audit chain commit together) and then commits.
 *
 * Index used: `actions_pending_idx` (partial, on
 *   (status, created_at) WHERE status = 'pending'
 * ) from migration 0005 — keeps the scan fast even when the table grows.
 */
export async function listStalePendingActions(
  tx: Tx,
  input: { readonly olderThanCreatedAt: Date; readonly limit: number }
): Promise<readonly ActionRow[]> {
  const rows = (await tx.execute(sql`
    SELECT
      id, account_uuid, agent_id, delegated_authority_jti,
      target_rail, target_operation, status, initiated_by, actor_type,
      request_payload_redacted, result_redacted, error_code, traceparent,
      app_id, app_correlation_id, business_op_id, idempotency_key,
      created_at, completed_at
    FROM actions
    WHERE status = 'pending'
      AND created_at < ${input.olderThanCreatedAt.toISOString()}::timestamptz
    ORDER BY created_at ASC, id ASC
    LIMIT ${input.limit}
    FOR UPDATE SKIP LOCKED
  `)) as unknown as readonly {
    id: string;
    account_uuid: string;
    agent_id: string;
    delegated_authority_jti: string | null;
    target_rail: string;
    target_operation: string;
    status: string;
    initiated_by: string;
    actor_type: string | null;
    request_payload_redacted: Record<string, unknown>;
    result_redacted: Record<string, unknown> | null;
    error_code: string | null;
    traceparent: string | null;
    app_id: string;
    app_correlation_id: string | null;
    business_op_id: string | null;
    idempotency_key: string;
    // Raw `tx.execute(sql`…`)` returns postgres-js native types — timestamps
    // come back as ISO strings, not Date objects, unlike Drizzle's typed
    // .select(). Normalise in the map() below.
    created_at: string | Date;
    completed_at: string | Date | null;
  }[];

  // Map snake_case driver shape → camelCase ActionRow shape consumed by
  // the rest of the module. This is the only call site where we hand-roll
  // SQL (so we can append FOR UPDATE SKIP LOCKED), so the mapping is
  // local rather than a shared helper.
  return rows.map((r) => ({
    id: r.id,
    accountUuid: r.account_uuid,
    agentId: r.agent_id,
    delegatedAuthorityJti: r.delegated_authority_jti,
    targetRail: r.target_rail,
    targetOperation: r.target_operation,
    status: r.status,
    initiatedBy: r.initiated_by,
    actorType: r.actor_type,
    requestPayloadRedacted: r.request_payload_redacted,
    resultRedacted: r.result_redacted,
    errorCode: r.error_code,
    traceparent: r.traceparent,
    appId: r.app_id,
    appCorrelationId: r.app_correlation_id,
    businessOpId: r.business_op_id,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    completedAt:
      r.completed_at === null
        ? null
        : r.completed_at instanceof Date
          ? r.completed_at
          : new Date(r.completed_at),
  }));
}

export async function listActions(
  db: Db,
  input: ListActionsInput
): Promise<readonly ActionRow[]> {
  const filters: SQL[] = [];
  if (input.status) filters.push(eq(actions.status, input.status));
  if (input.agentId) filters.push(eq(actions.agentId, input.agentId));
  if (input.targetRail) filters.push(eq(actions.targetRail, input.targetRail));
  if (input.accountUuid) filters.push(eq(actions.accountUuid, input.accountUuid));
  if (input.cursorCreatedAt && input.cursorId) {
    const ltCreated = lt(actions.createdAt, input.cursorCreatedAt);
    const eqCreatedLtId = and(
      eq(actions.createdAt, input.cursorCreatedAt),
      lt(actions.id, input.cursorId)
    ) as SQL;
    filters.push(or(ltCreated, eqCreatedLtId) as SQL);
  }
  const rows = (await db
    .select()
    .from(actions)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(actions.createdAt), desc(actions.id))
    .limit(input.limit)) as unknown as ActionRow[];
  return rows;
}
