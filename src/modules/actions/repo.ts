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

import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
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
