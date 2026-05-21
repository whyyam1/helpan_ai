/**
 * Unit tests for the pure hash-chain primitive. The DB-side append path is
 * exercised in test/integration/briefings.audit.integration.test.ts where a
 * real Postgres connection is available.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEntryHash,
  computeEntryHashV2,
  computeEntryHashForVersion,
  CURRENT_AUDIT_HASH_VERSION,
  type V2HashInput,
} from './auditWriter.js';

describe('computeEntryHash', () => {
  it('is deterministic for identical inputs', () => {
    const a = computeEntryHash({
      id: '01ABCDEFGHIJKLMNOPQRSTUVWX',
      actorId: 'acc_00000000-0000-0000-0000-000000000001',
      action: 'briefing.create',
      resourceId: 'brf_01ABCDEFGHIJKLMNOPQRSTUVWX',
      detail: { briefing_type: 'alert', status: 'active' },
      previousHash: 'abc123',
    });
    const b = computeEntryHash({
      id: '01ABCDEFGHIJKLMNOPQRSTUVWX',
      actorId: 'acc_00000000-0000-0000-0000-000000000001',
      action: 'briefing.create',
      resourceId: 'brf_01ABCDEFGHIJKLMNOPQRSTUVWX',
      detail: { briefing_type: 'alert', status: 'active' },
      previousHash: 'abc123',
    });
    expect(a).toBe(b);
  });

  it('is invariant under object key reordering (canonical JSON)', () => {
    const a = computeEntryHash({
      id: 'X',
      actorId: 'Y',
      action: 'briefing.update',
      detail: { a: 1, b: 2 },
      previousHash: 'p',
    });
    const b = computeEntryHash({
      id: 'X',
      actorId: 'Y',
      action: 'briefing.update',
      detail: { b: 2, a: 1 },
      previousHash: 'p',
    });
    expect(a).toBe(b);
  });

  it('is sensitive to previous_hash (chain integrity)', () => {
    const base = {
      id: 'X',
      actorId: 'Y',
      action: 'briefing.create',
      detail: {},
    };
    const a = computeEntryHash({ ...base, previousHash: 'h1' });
    const b = computeEntryHash({ ...base, previousHash: 'h2' });
    expect(a).not.toBe(b);
  });

  it('is sensitive to id (no two entries share a hash even with identical context)', () => {
    const base = {
      actorId: 'Y',
      action: 'briefing.create',
      detail: {},
      previousHash: 'p',
    };
    expect(computeEntryHash({ ...base, id: 'A' })).not.toBe(
      computeEntryHash({ ...base, id: 'B' })
    );
  });

  it('returns a 64-char lowercase hex string (SHA-256)', () => {
    const h = computeEntryHash({
      id: 'X',
      actorId: 'Y',
      action: 'a',
      previousHash: 'p',
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles missing optional fields without throwing', () => {
    expect(() =>
      computeEntryHash({
        id: 'X',
        actorId: 'Y',
        action: 'a',
        previousHash: 'p',
      })
    ).not.toThrow();
  });

  // H-15 — v1 composition snapshot. Pre-H-15 rows verify under v1 forever;
  // any change to v1 here breaks the genesis-anchored chain. DO NOT MUTATE
  // this expected value — bump to v3 in a new migration instead.
  it('v1 snapshot — golden hash for a known input (regression guard)', () => {
    const h = computeEntryHash({
      id: '01H15TESTID0000000000000000',
      actorId: 'app:lunchdrop',
      action: 'briefing.create',
      resourceId: 'brf_01H15TEST0000000000000000',
      detail: { briefing_type: 'alert', status: 'active' },
      previousHash: 'previous',
    });
    expect(h).toBe(
      // Sha256(
      //   '01H15TESTID0000000000000000|app:lunchdrop|briefing.create|brf_01H15TEST0000000000000000|{"briefing_type":"alert","status":"active"}|previous'
      // ) — captured at H-15 lockdown; never mutate, bump version instead.
      '3b78918cc5207075fc21973992e226aa8c4e6ebc45de02f2310acd9758942617'
    );
  });
});

describe('CURRENT_AUDIT_HASH_VERSION', () => {
  it('is 2 after H-15', () => {
    expect(CURRENT_AUDIT_HASH_VERSION).toBe(2);
  });
});

describe('computeEntryHashV2', () => {
  const BASE: V2HashInput = {
    id: '01H15TESTID0000000000000000',
    actorType: 'agent',
    actorId: 'helpan-klokd-v1',
    accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
    action: 'action.dispatch',
    resourceType: 'action',
    resourceId: 'act_01H15TEST0000000000000000',
    appId: 'lunchdrop',
    requestId: 'req_test',
    traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
    outcome: 'success',
    initiatedBy: 'agent',
    agentId: 'helpan-klokd-v1',
    delegatedAuthorityJti: 'daa_01H15TEST0000000000000000',
    targetRail: 'kipkiren_pay',
    targetOperation: 'klokd.write.shift_pay',
    businessOpId: 'boi_test',
    detail: { result: { ok: true }, latency_ms: 12 },
    previousHash: 'previous_v2',
  };

  it('is deterministic for identical inputs', () => {
    expect(computeEntryHashV2(BASE)).toBe(computeEntryHashV2(BASE));
  });

  it('is invariant under detail key reordering', () => {
    const a = computeEntryHashV2({ ...BASE, detail: { a: 1, b: 2 } });
    const b = computeEntryHashV2({ ...BASE, detail: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it('differs from the v1 hash for the same id/actor/action/resource/detail/prev', () => {
    const v1 = computeEntryHash({
      id: BASE.id,
      actorId: BASE.actorId,
      action: BASE.action,
      resourceId: BASE.resourceId ?? undefined,
      detail: BASE.detail ?? undefined,
      previousHash: BASE.previousHash,
    });
    const v2 = computeEntryHashV2(BASE);
    expect(v1).not.toBe(v2);
  });

  // Each column covered by v2 (eleven beyond v1's six) must change the hash
  // when mutated — that's the entire point of H-15. Parameterised across them.
  it.each([
    ['actor_type', { actorType: 'user' }],
    ['account_uuid', { accountUuid: 'acc_00000000-0000-0000-0000-0000000000ff' }],
    ['app_id', { appId: 'someone_else' }],
    ['outcome', { outcome: 'failure' }],
    ['initiated_by', { initiatedBy: 'human' }],
    ['traceparent', { traceparent: '00-' + 'f'.repeat(32) + '-' + '0'.repeat(16) + '-01' }],
    ['agent_id', { agentId: 'helpan-chapaa-v1' }],
    ['delegated_authority_jti', { delegatedAuthorityJti: 'daa_OTHER' }],
    ['target_rail', { targetRail: 'todoku' }],
    ['target_operation', { targetOperation: 'helpan.read.briefings' }],
    ['business_op_id', { businessOpId: 'boi_other' }],
    ['resource_type', { resourceType: 'authority' }],
    ['request_id', { requestId: 'req_other' }],
  ] as const)('tampering with %s changes the v2 hash', (_label, override) => {
    const original = computeEntryHashV2(BASE);
    const tampered = computeEntryHashV2({ ...BASE, ...override });
    expect(tampered).not.toBe(original);
  });

  it('NULL / undefined behaves consistently (empty string in the canonical form)', () => {
    const withUndef = computeEntryHashV2({ ...BASE, accountUuid: undefined });
    const withNull = computeEntryHashV2({ ...BASE, accountUuid: null });
    expect(withUndef).toBe(withNull);
  });

  it('returns a 64-char lowercase hex string', () => {
    expect(computeEntryHashV2(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeEntryHashForVersion', () => {
  it('dispatches by version (v1 = legacy, v2 = current)', () => {
    const input: V2HashInput = {
      id: 'X',
      actorType: 'system',
      actorId: 'Y',
      action: 'a',
      requestId: 'r',
      outcome: 'success',
      previousHash: 'p',
    };
    const v1 = computeEntryHashForVersion(1, input);
    const v2 = computeEntryHashForVersion(2, input);
    // v1 ignores the new fields; v2 reads them. With everything else null,
    // they should differ purely because v2's prefix string is in the hash.
    expect(v1).not.toBe(v2);
    // v1 dispatch must equal a direct v1 call (proving the dispatcher
    // is just a thin selector, not a reimplementation).
    expect(v1).toBe(
      computeEntryHash({
        id: 'X',
        actorId: 'Y',
        action: 'a',
        previousHash: 'p',
      })
    );
  });
});
