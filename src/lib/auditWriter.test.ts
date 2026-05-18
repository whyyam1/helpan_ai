/**
 * Unit tests for the pure hash-chain primitive. The DB-side append path is
 * exercised in test/integration/briefings.audit.integration.test.ts where a
 * real Postgres connection is available.
 */

import { describe, it, expect } from 'vitest';
import { computeEntryHash } from './auditWriter.js';

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
});
