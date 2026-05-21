/**
 * Action dispatch service (H-4).
 *
 * Flow per OpenAPI §POST /actions/dispatch:
 *
 *   1. Decode the X-Delegated-Authority JWT to find the jti (unverified read —
 *      validateAuthority verifies the signature against Identiti's JWKS).
 *   2. Run the H-3 validator (`validateAuthority`) against the JWT + intended
 *      operation + amount. Reject with the validator's `rejection_reason` if
 *      `valid=false`.
 *   3. Check the input `account_uuid` matches the authority's account.
 *   4. Redact the payload (§9.5).
 *   5. Open a transaction:
 *        a. INSERT the action row with status='pending'.
 *        b. Append an `action.dispatch` audit entry with §A.11 fields:
 *           agent_id, delegated_authority_jti, target_rail, target_operation,
 *           business_op_id, traceparent.
 *        c. Increment `authority_usage` for the (authority, scope, window).
 *           Single-spend semantics (§A.1) — the window is consumed by the
 *           attempt, not by the success.
 *        d. COMMIT.
 *   6. Publish ACTION_DISPATCHED (best-effort, no Kafka → skip).
 *   7. Forward to the target-rail dispatcher with the JWT, traceparent,
 *      business_op_id, and idempotency_key in the outbound headers.
 *   8. Open a second transaction:
 *        a. UPDATE the action row → 'completed' / 'failed'.
 *        b. Append an `action.complete` or `action.fail` audit entry with
 *           the same §A.11 fields so the two chain entries (dispatch +
 *           outcome) are joinable by `business_op_id` / `resource_id`.
 *        c. COMMIT.
 *   9. Publish ACTION_COMPLETED or ACTION_FAILED.
 *  10. Return the updated Action DTO.
 *
 * The two-phase persistence (steps 5 + 8) means a crash between commit-A
 * and the outbound call leaves the row in `pending`; an operator (or
 * future reaper) can settle it. The audit chain is intact either way.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';
import { decodeJwt } from 'jose';
import { appendAuditEntry } from '../../lib/auditWriter.js';
import { periodWindowKey } from '../../lib/periodWindow.js';
import {
  EVENT_ACTION_COMPLETED,
  EVENT_ACTION_DISPATCHED,
  EVENT_ACTION_FAILED,
  SCHEMA_VERSION,
  TOPIC_ACTION_EVENTS,
} from '../../lib/kafka/topics.js';
import type { KafkaProducerLike } from '../../lib/kafka/producer.js';
import type { Db } from '../../db/client.js';
import type {
  DispatcherRegistry,
  DispatchOutcome,
} from '../../lib/dispatchers/dispatcher.js';
import {
  validateAuthority,
  type ValidationDeps,
} from '../authorities/service.js';
import { incrementAuthorityUsage } from '../authorities/repo.js';
import type { AuthorityScopeDto } from '../authorities/schemas.js';
import {
  getActionById,
  insertAction,
  listActions,
  markActionCompleted,
  markActionFailed,
  type ActionRow,
} from './repo.js';
import { redactPayload } from './payloadRedactor.js';
import type {
  ActionDto,
  ActionInitiatedBy,
  ActionStatus,
  ActionTargetRail,
} from './schemas.js';

const ACTION_ID_PREFIX = 'act_';

// ---------------------------------------------------------------------------
// Error type — mirrors AuthorityError shape so the same error-mapper handles both.
// ---------------------------------------------------------------------------

export class ActionError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly field?: string;
  readonly detail?: Record<string, unknown>;
  constructor(
    code: string,
    statusCode: number,
    message: string,
    extras?: { field?: string; detail?: Record<string, unknown> }
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    if (extras?.field !== undefined) this.field = extras.field;
    if (extras?.detail !== undefined) this.detail = extras.detail;
  }
}

// ---------------------------------------------------------------------------
// Dispatch deps + args
// ---------------------------------------------------------------------------

export interface DispatchActionDeps {
  readonly db: Db;
  readonly validationDeps: ValidationDeps;
  readonly dispatchers: DispatcherRegistry;
  readonly kafka?: KafkaProducerLike;
}

export interface DispatchAuditContext {
  readonly appId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  /** Optional W3C traceparent supplied by the caller; generated if absent. */
  readonly traceparent?: string;
}

export interface DispatchActionArgs {
  readonly accountUuid: string;
  readonly targetRail: ActionTargetRail;
  readonly targetOperation: string;
  readonly payload: Record<string, unknown>;
  readonly initiatedBy?: ActionInitiatedBy;
  /** Per-call amount (minor units) — used for limit checks at validate time. */
  readonly amountMinor?: number;
  /** Caller-supplied join key. Generated if absent. */
  readonly businessOpId?: string;
  /** Delegated authority JWT — the X-Delegated-Authority header value. */
  readonly delegatedAuthorityJwt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function dispatchAction(
  deps: DispatchActionDeps,
  audit: DispatchAuditContext,
  args: DispatchActionArgs
): Promise<ActionDto> {
  // ---- 1. Decode JWT (unverified read for the jti) ------------------------
  let jti: string;
  try {
    const decoded = decodeJwt(args.delegatedAuthorityJwt);
    if (typeof decoded.jti !== 'string') {
      throw new Error('jti missing');
    }
    jti = decoded.jti;
  } catch {
    throw new ActionError(
      'AUTH_AUTHORITY_MALFORMED',
      401,
      'X-Delegated-Authority header is not a decodable JWT'
    );
  }

  // ---- 2. Run the H-3 validator ------------------------------------------
  const validation = await validateAuthority(deps.validationDeps, jti, {
    token: args.delegatedAuthorityJwt,
    intendedOperation: args.targetOperation,
    ...(args.amountMinor !== undefined ? { amountMinor: args.amountMinor } : {}),
  });

  if (!validation.valid) {
    throw mapRejectionToError(validation.rejectionReason);
  }

  const authority = validation.authority;

  // ---- 3. Account scoping -------------------------------------------------
  if (args.accountUuid !== authority.account_uuid) {
    throw new ActionError(
      'ACTION_ACCOUNT_MISMATCH',
      403,
      'Authority does not authorise this account',
      { detail: { authority_account: authority.account_uuid } }
    );
  }

  // ---- 4. Resolve covering scope (for usage tracking) ---------------------
  const coveringScope = authority.scopes.find(
    (s: AuthorityScopeDto) => s.scope_id === args.targetOperation
  );
  if (!coveringScope) {
    // Defensive: validateAuthority already enforced scope coverage; if we
    // got here without a covering scope something is structurally wrong.
    throw new ActionError(
      'ACTION_SCOPE_RESOLUTION',
      500,
      'Validator passed but no covering scope on authority'
    );
  }

  // ---- 5. Redact payload --------------------------------------------------
  const requestPayloadRedacted = redactPayload(args.payload);

  // ---- 6. Generate ids + traceparent + business_op_id --------------------
  const actionId = `${ACTION_ID_PREFIX}${generateUlid()}`;
  const businessOpId = args.businessOpId ?? `boi_${generateUlid()}`;
  const traceparent = audit.traceparent ?? generateTraceparent();
  const initiatedBy = args.initiatedBy ?? 'agent';
  const now = new Date();
  const periodWindow = periodWindowKey(coveringScope.period, now);

  // ---- 7. Phase A — persist 'pending' + audit + usage --------------------
  await deps.db.transaction(async (tx) => {
    await insertAction(tx as never, {
      id: actionId,
      accountUuid: args.accountUuid,
      agentId: authority.agent_id,
      delegatedAuthorityJti: jti,
      targetRail: args.targetRail,
      targetOperation: args.targetOperation,
      initiatedBy,
      actorType: initiatedBy === 'human' ? 'human' : 'agent',
      requestPayloadRedacted,
      traceparent,
      appId: audit.appId,
      businessOpId,
      idempotencyKey: audit.idempotencyKey,
    });
    await appendAuditEntry(tx, {
      actorType: 'agent',
      actorId: authority.agent_id,
      accountUuid: args.accountUuid,
      action: 'action.dispatch',
      resourceType: 'action',
      resourceId: actionId,
      appId: audit.appId,
      requestId: audit.requestId,
      traceparent,
      outcome: 'success',
      initiatedBy,
      agentId: authority.agent_id,
      delegatedAuthorityJti: jti,
      targetRail: args.targetRail,
      targetOperation: args.targetOperation,
      businessOpId,
      detail: {
        request_payload: requestPayloadRedacted,
        ...(args.amountMinor !== undefined ? { amount_minor: args.amountMinor } : {}),
      },
    });
    await incrementAuthorityUsage(tx, {
      authorityId: jti,
      scopeId: coveringScope.scope_id,
      periodWindow,
      amountMinor: BigInt(args.amountMinor ?? 0),
    });
  });

  // ---- 8. Publish ACTION_DISPATCHED (best-effort) -------------------------
  await publishActionEvent(deps.kafka, EVENT_ACTION_DISPATCHED, {
    action_id: actionId,
    account_uuid: args.accountUuid,
    agent_id: authority.agent_id,
    delegated_authority_jti: jti,
    target_rail: args.targetRail,
    target_operation: args.targetOperation,
    business_op_id: businessOpId,
    traceparent,
    occurred_at: now.toISOString(),
  });

  // ---- 9. Phase B — outbound dispatch ------------------------------------
  const dispatcher = deps.dispatchers[args.targetRail];
  const outcome: DispatchOutcome = await dispatcher.dispatch({
    targetRail: args.targetRail,
    targetOperation: args.targetOperation,
    payload: args.payload,
    delegatedAuthorityJwt: args.delegatedAuthorityJwt,
    businessOpId,
    traceparent,
    idempotencyKey: audit.idempotencyKey,
    accountUuid: args.accountUuid,
  });

  // ---- 10. Phase C — persist terminal status + audit ---------------------
  const completedAt = new Date();
  const finalRow: ActionRow | null = await deps.db.transaction(async (tx) => {
    if (outcome.status === 'completed') {
      const updated = await markActionCompleted(tx as never, actionId, outcome.resultRedacted);
      await appendAuditEntry(tx, {
        actorType: 'agent',
        actorId: authority.agent_id,
        accountUuid: args.accountUuid,
        action: 'action.complete',
        resourceType: 'action',
        resourceId: actionId,
        appId: audit.appId,
        requestId: audit.requestId,
        traceparent,
        outcome: 'success',
        initiatedBy,
        agentId: authority.agent_id,
        delegatedAuthorityJti: jti,
        targetRail: args.targetRail,
        targetOperation: args.targetOperation,
        businessOpId,
        detail: {
          result: outcome.resultRedacted,
          latency_ms: outcome.latencyMs,
        },
      });
      return updated;
    }
    const updated = await markActionFailed(
      tx as never,
      actionId,
      outcome.errorCode,
      outcome.detail
    );
    await appendAuditEntry(tx, {
      actorType: 'agent',
      actorId: authority.agent_id,
      accountUuid: args.accountUuid,
      action: 'action.fail',
      resourceType: 'action',
      resourceId: actionId,
      appId: audit.appId,
      requestId: audit.requestId,
      traceparent,
      outcome: 'failure',
      initiatedBy,
      agentId: authority.agent_id,
      delegatedAuthorityJti: jti,
      targetRail: args.targetRail,
      targetOperation: args.targetOperation,
      businessOpId,
      detail: {
        error_code: outcome.errorCode,
        latency_ms: outcome.latencyMs,
        ...(outcome.detail ? { rail_detail: outcome.detail } : {}),
      },
    });
    return updated;
  });

  if (!finalRow) {
    throw new ActionError(
      'ACTION_LOST',
      500,
      `Action ${actionId} was inserted but did not survive the terminal update`
    );
  }

  // ---- 11. Publish completion event --------------------------------------
  await publishActionEvent(
    deps.kafka,
    outcome.status === 'completed' ? EVENT_ACTION_COMPLETED : EVENT_ACTION_FAILED,
    {
      action_id: actionId,
      account_uuid: args.accountUuid,
      agent_id: authority.agent_id,
      delegated_authority_jti: jti,
      target_rail: args.targetRail,
      target_operation: args.targetOperation,
      business_op_id: businessOpId,
      traceparent,
      ...(outcome.status === 'failed' ? { error_code: outcome.errorCode } : {}),
      occurred_at: completedAt.toISOString(),
    }
  );

  // ---- 12. DTO -----------------------------------------------------------
  return toActionDto(finalRow);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readAction(db: Db, id: string): Promise<ActionDto | null> {
  const row = await getActionById(db, id);
  return row ? toActionDto(row) : null;
}

export interface ListActionsForQueryInput {
  readonly status?: ActionStatus;
  readonly agentId?: string;
  readonly targetRail?: ActionTargetRail;
  /** Account scope — set by the caller when a customer JWT pins it. */
  readonly accountUuid?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListActionsForQueryResult {
  readonly items: readonly ActionDto[];
  readonly nextCursor: string | null;
}

export async function listActionsForQuery(
  db: Db,
  input: ListActionsForQueryInput
): Promise<ListActionsForQueryResult> {
  const limit = clampLimit(input.limit);
  const cursor = input.cursor ? parseCursor(input.cursor) : null;
  const rows = await listActions(db, {
    ...(input.status ? { status: input.status } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.targetRail ? { targetRail: input.targetRail } : {}),
    ...(input.accountUuid ? { accountUuid: input.accountUuid } : {}),
    ...(cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {}),
    limit: limit + 1,
  });
  const items = rows.slice(0, limit).map(toActionDto);
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = rows[limit - 1]!;
    nextCursor = encodeCursor(last.createdAt, last.id);
  }
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toActionDto(row: ActionRow): ActionDto {
  return {
    id: row.id,
    account_uuid: row.accountUuid,
    agent_id: row.agentId,
    delegated_authority_jti: row.delegatedAuthorityJti,
    target_rail: row.targetRail as ActionTargetRail,
    target_operation: row.targetOperation,
    status: row.status as ActionStatus,
    initiated_by: row.initiatedBy as ActionInitiatedBy,
    request_payload: row.requestPayloadRedacted,
    result: row.resultRedacted,
    error_code: row.errorCode,
    traceparent: row.traceparent,
    business_op_id: row.businessOpId,
    created_at: row.createdAt.toISOString(),
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return 50;
  if (raw < 1) return 1;
  if (raw > 200) return 200;
  return raw;
}

interface ParsedCursor {
  readonly createdAt: Date;
  readonly id: string;
}

function parseCursor(cursor: string): ParsedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Map a rejected-validation reason to an HTTP error.
 *
 *   token_invalid_signature → 401 AUTH_AUTHORITY_INVALID
 *   token_revoked           → 401 AUTH_AUTHORITY_REVOKED
 *   token_expired           → 401 AUTH_AUTHORITY_EXPIRED
 *   scope_not_covered       → 403 AUTH_SCOPE_NOT_COVERED
 *   amount_exceeds_limit    → 422 AUTHORITY_LIMIT_EXCEEDED
 *   period_limit_exhausted  → 422 AUTHORITY_PERIOD_EXHAUSTED
 *   account_suspended       → 401 AUTH_AUTHORITY_INVALID
 *   null (validator quirk)  → 401 AUTH_AUTHORITY_INVALID
 */
function mapRejectionToError(reason: string | null): ActionError {
  switch (reason) {
    case 'token_invalid_signature':
      return new ActionError('AUTH_AUTHORITY_INVALID', 401, 'Delegated authority token failed signature verification');
    case 'token_revoked':
      return new ActionError('AUTH_AUTHORITY_REVOKED', 401, 'Delegated authority has been revoked');
    case 'token_expired':
      return new ActionError('AUTH_AUTHORITY_EXPIRED', 401, 'Delegated authority has expired');
    case 'scope_not_covered':
      return new ActionError('AUTH_SCOPE_NOT_COVERED', 403, 'Authority scope does not cover the requested operation');
    case 'amount_exceeds_limit':
      return new ActionError('AUTHORITY_LIMIT_EXCEEDED', 422, 'Amount exceeds the per-call limit on the authority scope');
    case 'period_limit_exhausted':
      return new ActionError('AUTHORITY_PERIOD_EXHAUSTED', 422, 'Per-period spend limit on the authority scope is exhausted');
    case 'account_suspended':
      return new ActionError('AUTH_AUTHORITY_INVALID', 401, 'Authority is bound to a suspended account');
    default:
      return new ActionError('AUTH_AUTHORITY_INVALID', 401, 'Delegated authority is not valid for this operation');
  }
}

/**
 * Generate a W3C traceparent header value (`00-<32 hex>-<16 hex>-01`).
 * Used when the caller didn't supply one — the rail still needs a value
 * to put on the outbound dispatch call so the target rail's audit log
 * gets joinable trace ids.
 */
function generateTraceparent(): string {
  const traceId = randomHex(16);
  const parentId = randomHex(8);
  return `00-${traceId}-${parentId}-01`;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  cryptoGetRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Indirection so we can avoid a Node-specific `crypto` import here.
function cryptoGetRandomValues(arr: Uint8Array): void {
  // Node ≥ 19 has globalThis.crypto.getRandomValues per Web Crypto.
  (globalThis as { crypto: { getRandomValues(arr: Uint8Array): Uint8Array } }).crypto.getRandomValues(arr);
}

/**
 * Best-effort Kafka publish. No producer → skip silently. Failures are
 * logged elsewhere (the producer's `publish` resolves with an error result
 * the caller may inspect); we don't fail the request on a Kafka miss.
 */
async function publishActionEvent(
  kafka: KafkaProducerLike | undefined,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!kafka) return;
  try {
    await kafka.publish({
      topic: TOPIC_ACTION_EVENTS,
      key: String(payload['account_uuid'] ?? ''),
      value: {
        schema_version: SCHEMA_VERSION,
        event_type: eventType,
        ...payload,
      },
    });
  } catch {
    // Intentionally swallowed — the action row + audit chain are authoritative.
  }
}
