/**
 * Action reaper integration tests (H-16). Closes RECAP §6.21.
 *
 * Real Postgres. Mirrors the structure of the H-3b cascade-revocation tests:
 * insert a pending action older than the threshold, run reapStaleActions,
 * verify (a) the row settled to failed/REAPER_UNRESOLVED, (b) an
 * action.fail audit entry chained off the previous head, (c) §A.11 columns
 * propagated, (d) fresh rows are NOT touched.
 *
 * The reaper does NOT depend on the in-process dispatcher (it doesn't
 * retry), so no dispatcher injection is needed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { reapStaleActions } from '../../src/workers/actionReaper/reaper.js';
import {
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('reapStaleActions (real Postgres)', () => {
  let handle: RealDbHandle;

  beforeAll(async () => {
    const h = await withRealDb();
    if (!h) throw new Error('TEST_DATABASE_URL set but withRealDb returned null');
    handle = h;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetTestData(handle.sql);
    // The reaper writes audit entries; appendAuditEntry needs an existing
    // agent row for any FK references (actions.agent_id → agents). Seed
    // a minimal agent so the test fixtures can FK to it.
    await handle.sql`
      INSERT INTO agents (id, name, agent_class, owner_app_id, status)
      VALUES ('agt_reaper_test_agent', 'Reaper Test Agent', 'portfolio_app', 'lunchdrop', 'active')
    `;
  });

  /**
   * Insert a synthetic pending action with a chosen created_at. Bypasses
   * the dispatch service so we can precisely control the row state — this
   * is exactly the post-Phase-A-pre-Phase-B shape the reaper exists to settle.
   */
  async function insertPendingAction(args: {
    id: string;
    createdAt: Date;
    accountUuid?: string;
    appId?: string;
    targetRail?: 'kipkiren_pay' | 'identiti' | 'todoku';
    targetOperation?: string;
    businessOpId?: string;
    traceparent?: string;
  }): Promise<void> {
    const accountUuid = args.accountUuid ?? 'acc_00000000-0000-0000-0000-000000000001';
    const appId = args.appId ?? 'lunchdrop';
    const targetRail = args.targetRail ?? 'kipkiren_pay';
    const targetOperation = args.targetOperation ?? 'helpan.read.briefings';
    const businessOpId = args.businessOpId ?? `boi_${randomUUID()}`;
    const traceparent = args.traceparent ?? '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';
    await handle.sql`
      INSERT INTO actions (
        id, account_uuid, agent_id, delegated_authority_jti,
        target_rail, target_operation, status, initiated_by, actor_type,
        request_payload_redacted, traceparent, app_id, business_op_id,
        idempotency_key, created_at
      ) VALUES (
        ${args.id},
        ${accountUuid},
        'agt_reaper_test_agent',
        NULL,
        ${targetRail},
        ${targetOperation},
        'pending',
        'agent',
        'agent',
        '{"note":"redacted"}'::jsonb,
        ${traceparent},
        ${appId},
        ${businessOpId},
        ${'idk_' + randomUUID()},
        ${args.createdAt.toISOString()}::timestamptz
      )
    `;
  }

  it('settles a stale pending action to failed/REAPER_UNRESOLVED and writes the audit entry', async () => {
    // Created 30 minutes ago — well past the 600s default we'll use.
    const createdAt = new Date(Date.now() - 30 * 60 * 1000);
    await insertPendingAction({
      id: 'act_01STALETEST00000000000001',
      createdAt,
      businessOpId: 'boi_reaper_test_1',
    });

    const result = await reapStaleActions(
      { db: handle.db },
      { staleAfterSeconds: 600, batchSize: 10 }
    );
    expect(result.reaped).toBe(1);
    expect(result.reapedIds).toContain('act_01STALETEST00000000000001');
    expect(result.errors).toBe(0);

    // Row settled
    const row = (await handle.sql`
      SELECT status, error_code, result_redacted, completed_at
      FROM actions WHERE id = 'act_01STALETEST00000000000001'
    `) as unknown as {
      status: string;
      error_code: string;
      result_redacted: Record<string, unknown>;
      completed_at: Date | null;
    }[];
    expect(row[0]!.status).toBe('failed');
    expect(row[0]!.error_code).toBe('REAPER_UNRESOLVED');
    expect(row[0]!.completed_at).not.toBeNull();
    expect(row[0]!.result_redacted['reason']).toBe('reaper_settled_orphaned_pending_action');

    // Audit entry chained
    const audit = (await handle.sql`
      SELECT action, actor_type, actor_id, agent_id, business_op_id,
             target_rail, target_operation, traceparent, outcome, hash_version
      FROM audit_log
      WHERE resource_id = 'act_01STALETEST00000000000001'
        AND action = 'action.fail'
    `) as unknown as {
      action: string;
      actor_type: string;
      actor_id: string;
      agent_id: string;
      business_op_id: string;
      target_rail: string;
      target_operation: string;
      traceparent: string;
      outcome: string;
      hash_version: number;
    }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_type).toBe('system');
    expect(audit[0]!.actor_id).toBe('helpan-ai-rail:reaper');
    expect(audit[0]!.agent_id).toBe('agt_reaper_test_agent');
    expect(audit[0]!.business_op_id).toBe('boi_reaper_test_1');
    expect(audit[0]!.target_rail).toBe('kipkiren_pay');
    expect(audit[0]!.outcome).toBe('failure');
    expect(audit[0]!.hash_version).toBe(2); // H-15 writer pin
  });

  it('leaves fresh pending actions untouched', async () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000);
    const fresh = new Date(Date.now() - 60 * 1000); // 1 minute old
    await insertPendingAction({ id: 'act_01STALEFRESHSTALE0000001', createdAt: stale });
    await insertPendingAction({ id: 'act_01STALEFRESHFRESH0000001', createdAt: fresh });

    const result = await reapStaleActions(
      { db: handle.db },
      { staleAfterSeconds: 600, batchSize: 10 }
    );
    expect(result.reaped).toBe(1);
    expect(result.reapedIds).toEqual(['act_01STALEFRESHSTALE0000001']);

    const freshStatus = (await handle.sql`
      SELECT status FROM actions WHERE id = 'act_01STALEFRESHFRESH0000001'
    `) as unknown as { status: string }[];
    expect(freshStatus[0]!.status).toBe('pending');
  });

  it('returns an empty result when nothing is stale', async () => {
    await insertPendingAction({
      id: 'act_01STALEEMPTY00000000001',
      createdAt: new Date(Date.now() - 30 * 1000), // 30s old
    });
    const result = await reapStaleActions(
      { db: handle.db },
      { staleAfterSeconds: 600, batchSize: 10 }
    );
    expect(result.reaped).toBe(0);
    expect(result.reapedIds).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it('respects batchSize — processes up to N stale rows per call', async () => {
    const old = new Date(Date.now() - 30 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await insertPendingAction({
        id: `act_01BATCHED${String(i).padStart(16, '0')}`,
        createdAt: old,
      });
    }
    const result = await reapStaleActions(
      { db: handle.db },
      { staleAfterSeconds: 600, batchSize: 3 }
    );
    expect(result.reaped).toBe(3);
    // The remaining 2 are still pending.
    const remaining = (await handle.sql`
      SELECT count(*)::int AS n FROM actions
      WHERE status = 'pending'
    `) as unknown as { n: number }[];
    expect(remaining[0]!.n).toBe(2);
  });

  it('audit chain stays intact across the reap (verifier-equivalent: previous_hash chains forward)', async () => {
    const old = new Date(Date.now() - 30 * 60 * 1000);
    await insertPendingAction({ id: 'act_01CHAINTEST000000000001', createdAt: old });
    await insertPendingAction({ id: 'act_01CHAINTEST000000000002', createdAt: old });

    await reapStaleActions({ db: handle.db }, { staleAfterSeconds: 600, batchSize: 10 });

    const chain = (await handle.sql`
      SELECT id, previous_hash, entry_hash, action, hash_version
      FROM audit_log
      ORDER BY created_at ASC, id ASC
    `) as unknown as {
      id: string;
      previous_hash: string | null;
      entry_hash: string;
      action: string;
      hash_version: number;
    }[];
    // Genesis + 2 reaper-written entries (this test inserts no other audits)
    expect(chain.length).toBe(3);
    expect(chain[0]!.action).toBe('audit_log.genesis');
    expect(chain[1]!.previous_hash).toBe(chain[0]!.entry_hash);
    expect(chain[2]!.previous_hash).toBe(chain[1]!.entry_hash);
    expect(chain[1]!.hash_version).toBe(2);
    expect(chain[2]!.hash_version).toBe(2);
  });

  it('age_seconds in audit detail reflects the row age at settlement', async () => {
    const minutesOld = 15;
    const createdAt = new Date(Date.now() - minutesOld * 60 * 1000);
    await insertPendingAction({ id: 'act_01AGEDETAIL0000000000001', createdAt });

    await reapStaleActions({ db: handle.db }, { staleAfterSeconds: 600, batchSize: 10 });

    const audit = (await handle.sql`
      SELECT detail FROM audit_log WHERE resource_id = 'act_01AGEDETAIL0000000000001'
    `) as unknown as { detail: Record<string, unknown> }[];
    const ageSeconds = audit[0]!.detail['age_seconds'] as number;
    // Allow ~5s of test-execution drift either way; 15 min == 900s nominal.
    expect(ageSeconds).toBeGreaterThanOrEqual(895);
    expect(ageSeconds).toBeLessThanOrEqual(910);
  });

  // Silence "no-unused-import" — drizzleSql intentionally re-exported for
  // future tests that may need raw SQL composition; tests today don't.
  void drizzleSql;
});
