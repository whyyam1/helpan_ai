import { describe, it, expect } from 'vitest';
import { buildDelegatedAuthorityClaims } from './claimBuilder.js';

const ISSUER = 'https://api.identiti.co.ke';
const HELPAN_AUD = 'https://api.helpan.co.ke';
const ACCOUNT = 'acc_00000000-0000-0000-0000-000000000001';
const AGENT = 'agt_01TESTAGENT0000000000000A';

describe('buildDelegatedAuthorityClaims', () => {
  it('builds a §2.3-shaped claim set with daa_ jti', () => {
    const built = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      scopeRails: { 'helpan.read.briefings': 'helpan' },
      now: new Date('2026-05-18T10:00:00.000Z'),
    });
    expect(built.jti).toMatch(/^daa_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(built.claims.token_class).toBe('delegated_authority');
    expect(built.claims.initiated_by).toBe('agent');
    expect(built.claims.actor).toEqual({ type: 'agent', agent_id: AGENT });
    expect(built.claims.iss).toBe(ISSUER);
    expect(built.claims.sub).toBe(ACCOUNT);
    expect(built.claims.exp - built.claims.iat).toBe(3600);
  });

  it('jti is consistent across claims.jti, built.jti, and revocation_endpoint', () => {
    const built = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 600,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      scopeRails: { 'helpan.read.briefings': 'helpan' },
    });
    expect(built.claims.jti).toBe(built.jti);
    expect(built.claims.revocation_endpoint).toBe(
      `${HELPAN_AUD}/v1/authorities/${built.jti}/validate`
    );
  });

  it('aud carries Helpan plus the platform-rail audience for each scope rail', () => {
    const built = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [
        { scope_id: 'kipkiren.write.payments' },
        { scope_id: 'todoku.write.notifications' },
      ],
      scopeRails: {
        'kipkiren.write.payments': 'kipkiren_pay',
        'todoku.write.notifications': 'todoku',
      },
    });
    expect(built.claims.aud).toContain(HELPAN_AUD);
    expect(built.claims.aud).toContain('https://api.pay.kipkiren.co.ke');
    expect(built.claims.aud).toContain('https://api.todoku.co.ke');
  });

  it('app-level scopes add no extra audience (dispatch-mediated)', () => {
    const built = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [{ scope_id: 'lunchdrop.write.orders' }],
      scopeRails: { 'lunchdrop.write.orders': 'lunchdrop' },
    });
    expect(built.claims.aud).toEqual([HELPAN_AUD]);
  });

  it('includes step_up_jti only when supplied', () => {
    const withStepUp = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [{ scope_id: 'kipkiren.write.payments' }],
      scopeRails: { 'kipkiren.write.payments': 'kipkiren_pay' },
      stepUpJti: 'stp_01TESTSTEPUP000000000000A',
    });
    expect(withStepUp.claims.step_up_jti).toBe('stp_01TESTSTEPUP000000000000A');

    const without = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      scopeRails: { 'helpan.read.briefings': 'helpan' },
    });
    expect(without.claims.step_up_jti).toBeUndefined();
  });

  it('drops undefined / empty scope fields so Identiti additionalProperties:false passes', () => {
    const built = buildDelegatedAuthorityClaims({
      issuer: ISSUER,
      helpanAudience: HELPAN_AUD,
      accountUuid: ACCOUNT,
      agentId: AGENT,
      ttlSeconds: 3600,
      scopes: [
        {
          scope_id: 'kipkiren.write.payments',
          amount_limit_minor: 500000,
          category_whitelist: [],
        },
      ],
      scopeRails: { 'kipkiren.write.payments': 'kipkiren_pay' },
    });
    const scope = built.claims.scopes[0]!;
    expect(scope.amount_limit_minor).toBe(500000);
    expect('category_whitelist' in scope).toBe(false); // empty array dropped
    expect('per_period_limit_minor' in scope).toBe(false);
  });
});
