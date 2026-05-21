/**
 * Audit-chain verifier (H-15 — closes RECAP §6.18).
 *
 *   npm run audit:verify
 *
 * Walks the `audit_log` table in (created_at, id) order. For each row:
 *
 *   1. Validate that `previous_hash` equals the prior row's `entry_hash`
 *      (chain pointer integrity).
 *   2. Recompute `entry_hash` using the composition specified by the row's
 *      `hash_version` and compare to the stored hash.
 *
 * The genesis row (`action='audit_log.genesis'` from migration 0001) is a
 * special case — its hash is the literal sha256('helpan-ai-genesis'), not a
 * `computeEntryHash*` output. The verifier skips the recompute step for that
 * row and just checks its hash matches the constant.
 *
 * Exits 0 with a CLEAN summary if the chain is intact; exits 1 and reports
 * the first drift on the first failure (and continues scanning so the full
 * report is useful for forensics).
 *
 * Read-only. Safe to run against production.
 */

import { createHash } from 'node:crypto';
import postgres from 'postgres';
import {
  computeEntryHashForVersion,
  type AuditHashVersion,
  type V2HashInput,
} from '../src/lib/auditWriter.js';

const GENESIS_ACTION = 'audit_log.genesis';
const GENESIS_LITERAL_HASH = createHash('sha256')
  .update('helpan-ai-genesis', 'utf8')
  .digest('hex');

interface ChainRow {
  readonly id: string;
  readonly app_id: string | null;
  readonly actor_type: string;
  readonly actor_id: string;
  readonly account_uuid: string | null;
  readonly action: string;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly agent_id: string | null;
  readonly delegated_authority_jti: string | null;
  readonly target_rail: string | null;
  readonly target_operation: string | null;
  readonly business_op_id: string | null;
  readonly request_id: string;
  readonly traceparent: string | null;
  readonly outcome: string;
  readonly initiated_by: string | null;
  readonly detail: Record<string, unknown> | null;
  readonly previous_hash: string | null;
  readonly entry_hash: string;
  readonly hash_version: number;
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
let failures = 0;

try {
  const rows = (await sql`
    SELECT
      id, app_id, actor_type, actor_id, account_uuid,
      action, resource_type, resource_id,
      agent_id, delegated_authority_jti, target_rail, target_operation,
      business_op_id, request_id, traceparent, outcome, initiated_by,
      detail, previous_hash, entry_hash, hash_version
    FROM audit_log
    ORDER BY created_at ASC, id ASC
  `) as unknown as readonly ChainRow[];

  console.warn(`[verify] scanning ${rows.length} audit_log rows`);

  let priorEntryHash: string | null = null;
  let v1Count = 0;
  let v2Count = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    // ---- 1. Chain pointer --------------------------------------------------
    if (row.previous_hash !== priorEntryHash) {
      failures++;
      console.error(
        `[verify] row ${i} (id=${row.id}) — previous_hash mismatch:\n` +
        `         stored:   ${row.previous_hash ?? 'NULL'}\n` +
        `         expected: ${priorEntryHash ?? 'NULL'}`
      );
    }

    // ---- 2. Entry-hash recompute ------------------------------------------
    if (row.action === GENESIS_ACTION) {
      if (row.entry_hash !== GENESIS_LITERAL_HASH) {
        failures++;
        console.error(
          `[verify] row ${i} (genesis) — entry_hash mismatch:\n` +
          `         stored:   ${row.entry_hash}\n` +
          `         expected: ${GENESIS_LITERAL_HASH}`
        );
      }
    } else {
      if (row.hash_version !== 1 && row.hash_version !== 2) {
        failures++;
        console.error(
          `[verify] row ${i} (id=${row.id}) — unknown hash_version=${row.hash_version}`
        );
      } else {
        const version: AuditHashVersion = row.hash_version === 1 ? 1 : 2;
        const v2input: V2HashInput = {
          id: row.id,
          actorType: row.actor_type,
          actorId: row.actor_id,
          accountUuid: row.account_uuid,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          appId: row.app_id,
          requestId: row.request_id,
          traceparent: row.traceparent,
          outcome: row.outcome,
          initiatedBy: row.initiated_by,
          agentId: row.agent_id,
          delegatedAuthorityJti: row.delegated_authority_jti,
          targetRail: row.target_rail,
          targetOperation: row.target_operation,
          businessOpId: row.business_op_id,
          detail: row.detail,
          previousHash: row.previous_hash ?? '',
        };
        const expected = computeEntryHashForVersion(version, v2input);
        if (expected !== row.entry_hash) {
          failures++;
          console.error(
            `[verify] row ${i} (id=${row.id}, hash_version=v${version}, action=${row.action}) — entry_hash mismatch:\n` +
            `         stored:   ${row.entry_hash}\n` +
            `         expected: ${expected}`
          );
        }
        if (version === 1) v1Count++;
        else v2Count++;
      }
    }

    priorEntryHash = row.entry_hash;
  }

  console.warn(`[verify] v1 rows: ${v1Count} · v2 rows: ${v2Count} · genesis: 1`);
  if (failures === 0) {
    console.warn('[verify] CHAIN INTACT — every row verifies.');
  } else {
    console.error(`[verify] CHAIN HAS DRIFT — ${failures} failure(s) above.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('[verify] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
