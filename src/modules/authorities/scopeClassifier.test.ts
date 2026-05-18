import { describe, it, expect } from 'vitest';
import {
  classifyScope,
  requiresStepUp,
  tightestTtlSeconds,
} from './scopeClassifier.js';
import type { OauthScopeRow } from '../oauthScopes/repo.js';

function scopeRow(overrides: Partial<OauthScopeRow> = {}): OauthScopeRow {
  return {
    id: 'helpan.read.briefings',
    name: 'Read briefings',
    description: 'x',
    rail: 'helpan',
    category: 'read_aggregate',
    defaultGrantable: true,
    elevationFriction: 'low',
    perScopeAmountCeilingMinor: null,
    perScopePeriodCeilingMinor: null,
    perScopeMaxTtlSeconds: 86400,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('classifyScope', () => {
  it('marks write_money as high-stakes', () => {
    const c = classifyScope(scopeRow({ category: 'write_money', elevationFriction: 'high' }));
    expect(c.isHighStakes).toBe(true);
  });

  it('marks write_identity as high-stakes', () => {
    const c = classifyScope(scopeRow({ category: 'write_identity', elevationFriction: 'medium' }));
    expect(c.isHighStakes).toBe(true);
  });

  it('marks read_behavioural as high-stakes', () => {
    const c = classifyScope(scopeRow({ category: 'read_behavioural', elevationFriction: 'low' }));
    expect(c.isHighStakes).toBe(true);
  });

  it('marks elevation_friction=high as high-stakes regardless of category', () => {
    const c = classifyScope(scopeRow({ category: 'admin', elevationFriction: 'high' }));
    expect(c.isHighStakes).toBe(true);
  });

  it('treats a plain read_aggregate / low scope as not high-stakes', () => {
    const c = classifyScope(scopeRow({ category: 'read_aggregate', elevationFriction: 'low' }));
    expect(c.isHighStakes).toBe(false);
  });

  it('carries through the TTL ceiling + amount/period ceilings', () => {
    const c = classifyScope(
      scopeRow({
        perScopeMaxTtlSeconds: 3600,
        perScopeAmountCeilingMinor: 500000n,
        perScopePeriodCeilingMinor: 5000000n,
      })
    );
    expect(c.maxTtlSeconds).toBe(3600);
    expect(c.amountCeilingMinor).toBe(500000n);
    expect(c.periodCeilingMinor).toBe(5000000n);
  });
});

describe('tightestTtlSeconds', () => {
  it('returns the smallest ceiling across a scope set', () => {
    const set = [
      classifyScope(scopeRow({ id: 'a', perScopeMaxTtlSeconds: 86400 })),
      classifyScope(scopeRow({ id: 'b', perScopeMaxTtlSeconds: 3600 })),
      classifyScope(scopeRow({ id: 'c', perScopeMaxTtlSeconds: 900 })),
    ];
    expect(tightestTtlSeconds(set)).toBe(900);
  });

  it('throws on an empty set', () => {
    expect(() => tightestTtlSeconds([])).toThrow(/empty/);
  });
});

describe('requiresStepUp', () => {
  it('is true when any scope is high-stakes', () => {
    const set = [
      classifyScope(scopeRow({ id: 'a', category: 'read_aggregate', elevationFriction: 'low' })),
      classifyScope(scopeRow({ id: 'b', category: 'write_money', elevationFriction: 'high' })),
    ];
    expect(requiresStepUp(set)).toBe(true);
  });

  it('is false when every scope is low-stakes', () => {
    const set = [
      classifyScope(scopeRow({ id: 'a', category: 'read_aggregate', elevationFriction: 'low' })),
      classifyScope(scopeRow({ id: 'b', category: 'write_comms', elevationFriction: 'medium' })),
    ];
    expect(requiresStepUp(set)).toBe(false);
  });
});
