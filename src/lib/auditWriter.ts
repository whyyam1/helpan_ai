/**
 * audit_log writer — appends a hash-chained entry to the rail's audit log.
 *
 * Hash chain invariant (per ERD §1.13 + auditLog.ts):
 *
 *     entry_hash[N] = SHA-256( <fields per hash_version> )
 *     previous_hash[N] = entry_hash[N-1]
 *
 * **Hash versioning (H-15, RECAP §6.18 close).** Two compositions:
 *
 *   v1 (legacy):
 *     id | actor_id | action | resource_id | detail | previous_hash
 *
 *   v2 (current):
 *     "v2" | id | actor_type | actor_id | account_uuid | action |
 *     resource_type | resource_id | app_id | request_id | traceparent |
 *     outcome | initiated_by | agent_id | delegated_authority_jti |
 *     target_rail | target_operation | business_op_id | detail | previous_hash
 *
 * The "v2" string prefix is in the v2 hash itself — a v2 row can't be
 * misinterpreted as v1 even if `hash_version` is tampered. Rows written
 * before migration 0015 (including the genesis row from migration 0001)
 * stay at hash_version=1 and verify under v1. New rows are written at
 * v2. The chain pointer (`previous_hash`) is composition-agnostic — v2
 * chains off v1 cleanly across the cutover.
 *
 * The chain is seeded by migration 0001's genesis row. The first real entry
 * therefore reads the genesis row's `entry_hash` as its `previous_hash`.
 *
 * Concurrency: chain integrity requires serialisation of the read-latest +
 * insert-new pair. `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY)` is taken
 * inside the same transaction, so concurrent appenders queue per-rail at the
 * Postgres level — cost is microseconds, scope is the chain only.
 *
 * H-2 callers: the briefings handlers, for create / update / revoke. H-3
 * added authority issue / revoke entries. H-3.1 extends the input with the
 * §A.11 cross-rail audit fields (`agentId`, `delegatedAuthorityJti`,
 * `targetRail`, `targetOperation`, `businessOpId`) — all optional. Before
 * H-15 they were stored but unhashed; H-15 brings them under the chain.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { generateUlid } from '@kmv/platform-shared/ulid';
import type { Tx } from '../plugins/rlsContext.js';

/**
 * Postgres advisory lock key, scoped to the audit chain. Constant —
 * any 64-bit integer works; this one is arbitrary but kept stable so all
 * appenders agree.
 */
const AUDIT_CHAIN_LOCK_KEY = 7268010825743210n; // 'HELPANAI' as ascii roughly

export type AuditActorType = 'user' | 'agent' | 'operator' | 'system';
export type AuditOutcome = 'success' | 'failure';
export type AuditTargetRail = 'kipkiren_pay' | 'identiti' | 'todoku';

export interface AppendAuditEntryInput {
  readonly actorType: AuditActorType;
  /** Account UUID for `user` actors; agent_id for `agent`; literal for system/operator. */
  readonly actorId: string;
  readonly accountUuid?: string | undefined;
  readonly action: string;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly appId?: string | undefined;
  readonly requestId: string;
  readonly traceparent?: string | undefined;
  readonly outcome: AuditOutcome;
  readonly detail?: Record<string, unknown> | undefined;
  readonly initiatedBy?: 'human' | 'agent' | 'system' | undefined;
  // §A.11 cross-rail audit fields (H-3.1). All optional — populated where the
  // operation is agent-initiated and/or cross-rail; NULL otherwise.
  /** The agent that acted (NOT the agent acted upon). */
  readonly agentId?: string | undefined;
  /** The delegated authority that authorised an agent action. */
  readonly delegatedAuthorityJti?: string | undefined;
  /** Target rail for dispatched actions (H-4). */
  readonly targetRail?: AuditTargetRail | undefined;
  /** Target operation on the target rail (H-4). */
  readonly targetOperation?: string | undefined;
  /** Shared cross-rail business-operation id — the §A.11 forensic join key. */
  readonly businessOpId?: string | undefined;
}

export interface AppendedAuditEntry {
  readonly id: string;
  readonly entryHash: string;
  readonly previousHash: string;
}

/**
 * Stable, sorted-keys JSON encoding. Preserves chain hashability across
 * runs even when the caller serialises detail keys in different orders.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Hash version actively written by `appendAuditEntry`. Verifier reads the
 * stored `hash_version` per row, not this constant — so a future bump to
 * v3 leaves v2 rows verifying under v2.
 */
export const CURRENT_AUDIT_HASH_VERSION = 2 as const;

export type AuditHashVersion = 1 | 2;

/**
 * v1 composition — `id | actor_id | action | resource_id | detail | previous_hash`.
 * Preserved verbatim for backward verification of rows written before H-15
 * (incl. the H-2/H-3/H-3.1/H-3b/H-4 + per-app catalogue admissions).
 */
export function computeEntryHash(parts: {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceId?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;
  readonly previousHash: string;
}): string {
  const detailCanonical = canonicalJson(parts.detail ?? {});
  const input = [
    parts.id,
    parts.actorId,
    parts.action,
    parts.resourceId ?? '',
    detailCanonical,
    parts.previousHash,
  ].join('|');
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * v2 composition — covers every persisted column except `created_at`
 * (which is wall-clock and would make the hash flap on a re-insert /
 * timezone change). Order is locked; do not reorder without bumping to v3.
 */
export interface V2HashInput {
  readonly id: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly accountUuid?: string | null | undefined;
  readonly action: string;
  readonly resourceType?: string | null | undefined;
  readonly resourceId?: string | null | undefined;
  readonly appId?: string | null | undefined;
  readonly requestId: string;
  readonly traceparent?: string | null | undefined;
  readonly outcome: string;
  readonly initiatedBy?: string | null | undefined;
  readonly agentId?: string | null | undefined;
  readonly delegatedAuthorityJti?: string | null | undefined;
  readonly targetRail?: string | null | undefined;
  readonly targetOperation?: string | null | undefined;
  readonly businessOpId?: string | null | undefined;
  readonly detail?: Record<string, unknown> | null | undefined;
  readonly previousHash: string;
}

export function computeEntryHashV2(parts: V2HashInput): string {
  const detailCanonical = canonicalJson(parts.detail ?? {});
  const input = [
    'v2',
    parts.id,
    parts.actorType,
    parts.actorId,
    parts.accountUuid ?? '',
    parts.action,
    parts.resourceType ?? '',
    parts.resourceId ?? '',
    parts.appId ?? '',
    parts.requestId,
    parts.traceparent ?? '',
    parts.outcome,
    parts.initiatedBy ?? '',
    parts.agentId ?? '',
    parts.delegatedAuthorityJti ?? '',
    parts.targetRail ?? '',
    parts.targetOperation ?? '',
    parts.businessOpId ?? '',
    detailCanonical,
    parts.previousHash,
  ].join('|');
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute the hash for a row using its declared `hash_version`. Used by
 * the verifier — the writer always uses CURRENT_AUDIT_HASH_VERSION
 * directly.
 */
export function computeEntryHashForVersion(
  version: AuditHashVersion,
  parts: V2HashInput
): string {
  if (version === 1) {
    return computeEntryHash({
      id: parts.id,
      actorId: parts.actorId,
      action: parts.action,
      ...(parts.resourceId !== null && parts.resourceId !== undefined
        ? { resourceId: parts.resourceId }
        : {}),
      ...(parts.detail !== null && parts.detail !== undefined
        ? { detail: parts.detail }
        : {}),
      previousHash: parts.previousHash,
    });
  }
  return computeEntryHashV2(parts);
}

interface LatestHashRow {
  readonly entry_hash: string;
}

export async function appendAuditEntry(
  tx: Tx,
  input: AppendAuditEntryInput
): Promise<AppendedAuditEntry> {
  // Serialise per-chain. xact-scoped: released on COMMIT/ROLLBACK.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

  // jsonb_build_object is already used by migration 0001; the genesis row's
  // entry_hash is stored as a plain hex string, so a string-typed read here
  // is straightforward.
  const latest = (await tx.execute(
    sql`SELECT entry_hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1`
  )) as unknown as readonly LatestHashRow[];
  if (latest.length === 0) {
    throw new Error('audit_log empty — genesis row missing (migration 0001 must run first)');
  }
  const previousHash = latest[0]!.entry_hash;

  const id = generateUlid();
  // H-15: writer pins to v2. Verifier reads the per-row `hash_version` and
  // selects the composition; this constant is the only place that needs to
  // change when we bump to v3 in the future.
  const entryHash = computeEntryHashV2({
    id,
    actorType: input.actorType,
    actorId: input.actorId,
    accountUuid: input.accountUuid,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    appId: input.appId,
    requestId: input.requestId,
    traceparent: input.traceparent,
    outcome: input.outcome,
    initiatedBy: input.initiatedBy,
    agentId: input.agentId,
    delegatedAuthorityJti: input.delegatedAuthorityJti,
    targetRail: input.targetRail,
    targetOperation: input.targetOperation,
    businessOpId: input.businessOpId,
    detail: input.detail,
    previousHash,
  });

  const detailJson = JSON.stringify(input.detail ?? {});

  await tx.execute(sql`
    INSERT INTO audit_log (
      id, app_id, actor_type, actor_id, account_uuid, action,
      resource_type, resource_id,
      agent_id, delegated_authority_jti, target_rail, target_operation,
      business_op_id,
      request_id, traceparent, outcome, detail,
      previous_hash, entry_hash, hash_version, initiated_by
    ) VALUES (
      ${id},
      ${input.appId ?? null},
      ${input.actorType},
      ${input.actorId},
      ${input.accountUuid ?? null},
      ${input.action},
      ${input.resourceType ?? null},
      ${input.resourceId ?? null},
      ${input.agentId ?? null},
      ${input.delegatedAuthorityJti ?? null},
      ${input.targetRail ?? null},
      ${input.targetOperation ?? null},
      ${input.businessOpId ?? null},
      ${input.requestId},
      ${input.traceparent ?? null},
      ${input.outcome},
      ${detailJson}::jsonb,
      ${previousHash},
      ${entryHash},
      ${CURRENT_AUDIT_HASH_VERSION},
      ${input.initiatedBy ?? null}
    )
  `);

  return { id, entryHash, previousHash };
}
