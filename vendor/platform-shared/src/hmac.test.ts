import { describe, expect, it } from 'vitest';
import {
  buildCanonicalString,
  parseAuthorizationHeader,
  sha256Hex,
  signRequest,
  verifyHmac,
  verifyTimestamp,
} from './hmac.js';

describe('buildCanonicalString', () => {
  it('joins fields with newlines and uppercases the method', () => {
    const out = buildCanonicalString({
      method: 'post',
      pathAndQuery: '/v1/health',
      contentType: 'application/json; charset=utf-8',
      timestamp: '2026-05-05T10:00:00Z',
      bodySha256Hex: 'a'.repeat(64),
    });
    expect(out).toBe(
      [
        'POST',
        '/v1/health',
        'application/json; charset=utf-8',
        '2026-05-05T10:00:00Z',
        'a'.repeat(64),
      ].join('\n')
    );
  });
});

describe('signRequest / verifyHmac', () => {
  const canonical = 'GET\n/v1/health\n\n2026-05-05T10:00:00Z\n' + sha256Hex('');
  const secret = 'super-secret-key';

  it('round-trips a signature', () => {
    const sig = signRequest(canonical, secret);
    expect(verifyHmac(canonical, secret, sig)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(verifyHmac(canonical, secret, 'wrong-base64==')).toBe(false);
  });

  it('rejects when canonical string differs', () => {
    const sig = signRequest(canonical, secret);
    expect(verifyHmac(canonical + 'x', secret, sig)).toBe(false);
  });

  it('rejects when secret differs', () => {
    const sig = signRequest(canonical, secret);
    expect(verifyHmac(canonical, 'other-secret', sig)).toBe(false);
  });

  it('handles unequal-length signatures without throwing', () => {
    expect(verifyHmac(canonical, secret, 'short')).toBe(false);
  });
});

describe('parseAuthorizationHeader', () => {
  it('parses a well-formed Identiti header', () => {
    const out = parseAuthorizationHeader(
      'Identiti-HMAC-SHA256 app_id=kalunch_dev, signature=abc123=='
    );
    expect(out).toEqual({
      railPrefix: 'Identiti',
      appId: 'kalunch_dev',
      signature: 'abc123==',
    });
  });

  it('parses KipkirenPay and Todoku prefixes', () => {
    expect(
      parseAuthorizationHeader('KipkirenPay-HMAC-SHA256 app_id=foo, signature=YWJj')
    ).toMatchObject({ railPrefix: 'KipkirenPay' });
    expect(
      parseAuthorizationHeader('Todoku-HMAC-SHA256 app_id=foo, signature=YWJj')
    ).toMatchObject({ railPrefix: 'Todoku' });
  });

  it('rejects unknown prefix', () => {
    expect(
      parseAuthorizationHeader('Bearer-HMAC-SHA256 app_id=foo, signature=bar')
    ).toBeNull();
  });

  it('rejects malformed header', () => {
    expect(parseAuthorizationHeader('garbage')).toBeNull();
    expect(parseAuthorizationHeader('Identiti-HMAC-SHA256 nope')).toBeNull();
  });
});

describe('verifyTimestamp', () => {
  it('accepts a timestamp within tolerance', () => {
    const now = new Date().toISOString();
    expect(verifyTimestamp(now, 300)).toBe(true);
  });

  it('rejects a stale timestamp', () => {
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(verifyTimestamp(past, 300)).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(verifyTimestamp('not-a-date', 300)).toBe(false);
  });

  it('accepts a slightly future timestamp within tolerance (clock skew)', () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    expect(verifyTimestamp(future, 300)).toBe(true);
  });
});

describe('sha256Hex', () => {
  it('matches the well-known SHA-256 of empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
