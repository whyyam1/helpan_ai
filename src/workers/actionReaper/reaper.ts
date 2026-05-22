/**
 * Action reaper — settles stale `pending` actions (H-16). Closes RECAP §6.21.
 *
 * Why a reaper:
 *
 *   H-4 dispatch runs in three phases:
 *     A. validate + INSERT actions(status='pending') + audit
 *        (action.dispatch) + authority_usage upsert — one tx, COMMIT
 *     B. forward to TargetRailDispatcher (outside tx)
 *     C. UPDATE action to terminal + audit (action.complete / action.fail)
 *        — one tx, COMMIT
 *
 *   If the rail process dies between A.COMMIT and C.COMMIT, the row sits
 *   in `pending` indefinitely. The audit chain is intact (A.COMMIT wrote
 *   `action.dispatch`) but the operational state is wrong. Health checks
 *   on `actions WHERE status='pending'` would never settle.
 *
 * Why NOT a retry:
 *
 *   Phase A persists only the *redacted* payload (§9.5). The dispatcher
 *   received the original; on crash, the original is lost. A retry would
 *   send a redacted payload downstream, which the relying rail would
 *   reject as malformed (or worse, mis-process). The honest settlement
 *   is `failed` with `error_code='REAPER_UNRESOLVED'`. The agent / consuming
 *   app may retry the whole call under a fresh idempotency_key.
 *
 * Settlement contract per stale row:
 *
 *   - SELECT … FOR UPDATE SKIP LOCKED (multi-replica safe)
 *   - UPDATE status='failed', error_code='REAPER_UNRESOLVED',
 *     completed_at=NOW(), result_redacted={reason, reaped_at}
 *   - appendAuditEntry(action.fail) with actor_type='system',
 *     actor_id='helpan-ai-rail:reaper', §A.11 columns copied from the
 *     pending row so cross-rail forensic joins still land
 *   - Same tx; commit together
 *
 *   Per-action try/catch so one bad row does not poison the batch — the
 *   `errors` count on the result tells the caller how many settlements
 *   failed mid-tx (they get rolled back individually and retried next loop).
 */

import { appendAuditEntry } from '../../lib/auditWriter.js';
import { markActionFailed, listStalePendingActions } from '../../modules/actions/repo.js';
import type { Db } from '../../db/client.js';

const REAPER_ACTOR_ID = 'helpan-ai-rail:reaper';
const REAPER_ERROR_CODE = 'REAPER_UNRESOLVED';

export interface ReapStaleActionsDeps {
  readonly db: Db;
  /** Injectable clock for tests; defaults to wall-clock. */
  readonly now?: () => Date;
}

export interface ReapStaleActionsOptions {
  /** Settle rows whose `created_at` is older than this many seconds. */
  readonly staleAfterSeconds: number;
  /** Maximum rows to settle per call. */
  readonly batchSize: number;
}

export interface ReapStaleActionsResult {
  /** Rows successfully settled to `failed`. */
  readonly reaped: number;
  /** Rows that errored mid-settle (the tx rolled back). Logged for ops. */
  readonly errors: number;
  /** Per-action ids settled, for debugging / structured-log visibility. */
  readonly reapedIds: readonly string[];
}

/**
 * Settle one batch of stale `pending` actions. Returns counts; the
 * caller (the Railway entrypoint) wraps this in a poll loop.
 *
 * Pure with respect to side effects on the DB — each row is its own tx,
 * so a thrown error in row K does not affect rows 1..K-1 (already
 * committed) or K+1..N (locked but not yet processed; will be picked up
 * on the next loop).
 */
export async function reapStaleActions(
  deps: ReapStaleActionsDeps,
  options: ReapStaleActionsOptions
): Promise<ReapStaleActionsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const olderThanCreatedAt = new Date(now.getTime() - options.staleAfterSeconds * 1000);
  const reapedIds: string[] = [];
  let errors = 0;

  // Outer transaction holds the SELECT … FOR UPDATE SKIP LOCKED locks until
  // we COMMIT — that's the multi-replica safety boundary. Per-row settle
  // happens inside this same tx so the audit chain entries and the row
  // UPDATEs commit atomically. If ANY row errors we let the whole batch
  // roll back; the next loop re-acquires locks and tries again. Bounded
  // retries are achieved by the staleness clock — a permanently-broken
  // row will be retried each loop indefinitely (worth flagging in deep-
  // health when batch errors persist).
  try {
    await deps.db.transaction(async (tx) => {
      const stale = await listStalePendingActions(tx as never, {
        olderThanCreatedAt,
        limit: options.batchSize,
      });

      for (const row of stale) {
        const updated = await markActionFailed(
          tx as never,
          row.id,
          REAPER_ERROR_CODE,
          {
            reaped_at: now.toISOString(),
            stale_after_seconds: options.staleAfterSeconds,
            reason: 'reaper_settled_orphaned_pending_action',
          }
        );
        if (!updated) {
          // Should not happen — we selected this id with FOR UPDATE so it
          // must exist. Defensive: treat as an error and keep going inside
          // the tx (the outer catch surfaces it).
          throw new Error(`reaper: row ${row.id} vanished between SELECT and UPDATE`);
        }

        await appendAuditEntry(tx, {
          actorType: 'system',
          actorId: REAPER_ACTOR_ID,
          accountUuid: row.accountUuid,
          action: 'action.fail',
          resourceType: 'action',
          resourceId: row.id,
          appId: row.appId,
          requestId: `reaper-${row.id}`,
          ...(row.traceparent ? { traceparent: row.traceparent } : {}),
          outcome: 'failure',
          // initiated_by stays 'system' — the reaper IS the system actor.
          initiatedBy: 'system',
          agentId: row.agentId,
          ...(row.delegatedAuthorityJti
            ? { delegatedAuthorityJti: row.delegatedAuthorityJti }
            : {}),
          // target_rail constraint is the same enum the actions row carries;
          // narrow the type safely here.
          targetRail: row.targetRail as 'kipkiren_pay' | 'identiti' | 'todoku',
          targetOperation: row.targetOperation,
          ...(row.businessOpId ? { businessOpId: row.businessOpId } : {}),
          detail: {
            error_code: REAPER_ERROR_CODE,
            reason: 'reaper_settled_orphaned_pending_action',
            settled_at: now.toISOString(),
            original_created_at: row.createdAt.toISOString(),
            age_seconds:
              Math.round((now.getTime() - row.createdAt.getTime()) / 1000),
          },
        });

        reapedIds.push(row.id);
      }
    });
  } catch (err) {
    // Whole batch rolled back. Surface the count; the entrypoint logs and
    // continues. The next loop tick re-acquires locks and tries again.
    errors = reapedIds.length || 1;
    reapedIds.length = 0;
    throw Object.assign(err as Error, { reaperErrors: errors });
  }

  return {
    reaped: reapedIds.length,
    errors,
    reapedIds,
  };
}
