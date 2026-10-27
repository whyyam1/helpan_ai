/**
 * Unit tests for the HTTP dispatcher's outbound wire format.
 * Guards the cross-rail auth contract: the Authorization header must parse
 * under platform-shared's verifier, the HMAC must verify against the target's
 * per-rail timestamp header, and §A.11 headers must be attached.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCanonicalString,
  parseAuthorizationHeader,
  sha256Hex,
  verifyHmac,
} from '@kmv/platform-shared/hmac';
import type { DispatchInput, DispatcherTargetRail } from './dispatcher.js';
import { createHttpDispatcher } from './httpDispatcher.js';

const SECRET = 'f'.repeat(64);

const makeInput = (targetRail: DispatcherTargetRail): DispatchInput => ({
  targetRail,
  targetOperation: 'kipkiren.write.payments',
  payload: { amount_minor: 1000 },
  delegatedAuthorityJwt: 'header.body.sig',
  businessOpId: 'boi_test',
  traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
  idempotencyKey: 'idk_test',
  accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
});

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function capturingFetch(captured: Captured[], status = 200): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    captured.push({
      url: url.toString(),
      headers: init?.headers as Record<string, string>,
      body: init?.body as string,
    });
    return new Response(JSON.stringify({ ok: true, data: { id: 'x' } }), { status });
  }) as typeof fetch;
}

const CASES: Array<[DispatcherTargetRail, string, string]> = [
  ['kipkiren_pay', 'KipkirenPay', 'x-kipkirenpay-timestamp'],
  ['todoku', 'Todoku', 'x-todoku-timestamp'],
  ['identiti', 'Identiti', 'x-identiti-timestamp'],
];

describe('createHttpDispatcher wire format', () => {
  it.each(CASES)(
    '%s: Authorization parses as %s and HMAC verifies over %s',
    async (rail, prefix, tsHeader) => {
      const captured: Captured[] = [];
      const d = createHttpDispatcher({
        rail,
        baseUrl: 'https://target.example',
        dispatchPath: '/v1/dispatch',
        appId: 'helpan_ai',
        hmacSecret: SECRET,
        timestampHeader: tsHeader,
        fetch: capturingFetch(captured),
      });

      const out = await d.dispatch(makeInput(rail));
      expect(out.status).toBe('completed');

      const req = captured[0]!;
      expect(req.url).toBe('https://target.example/v1/dispatch');

      const parsed = parseAuthorizationHeader(req.headers['authorization']!);
      expect(parsed).not.toBeNull();
      expect(parsed!.railPrefix).toBe(prefix);
      expect(parsed!.appId).toBe('helpan_ai');

      const ts = req.headers[tsHeader];
      expect(ts).toBeDefined();
      const canonical = buildCanonicalString({
        method: 'POST',
        pathAndQuery: '/v1/dispatch',
        contentType: 'application/json',
        timestamp: ts!,
        bodySha256Hex: sha256Hex(req.body),
      });
      expect(verifyHmac(canonical, SECRET, parsed!.signature)).toBe(true);
    }
  );

  it('attaches the §A.2 / §A.11 cross-rail headers and envelope', async () => {
    const captured: Captured[] = [];
    const d = createHttpDispatcher({
      rail: 'kipkiren_pay',
      baseUrl: 'https://target.example',
      dispatchPath: '/v1/dispatch',
      appId: 'helpan_ai',
      hmacSecret: SECRET,
      timestampHeader: 'x-kipkirenpay-timestamp',
      fetch: capturingFetch(captured),
    });
    await d.dispatch(makeInput('kipkiren_pay'));

    const { headers, body } = captured[0]!;
    expect(headers['x-delegated-authority']).toBe('header.body.sig');
    expect(headers['x-idempotency-key']).toBe('idk_test');
    expect(headers['x-business-op-id']).toBe('boi_test');
    expect(headers['traceparent']).toMatch(/^00-/);
    expect(JSON.parse(body)).toEqual({
      operation: 'kipkiren.write.payments',
      account_uuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: { amount_minor: 1000 },
      business_op_id: 'boi_test',
    });
  });

  it('klokd: substitutes {operation} into the path and signs the full path', async () => {
    const captured: Captured[] = [];
    const d = createHttpDispatcher({
      rail: 'klokd',
      baseUrl: 'https://octopus.example',
      dispatchPath: '/api/v1/agents/dispatch/{operation}',
      appId: 'helpan_ai',
      hmacSecret: SECRET,
      timestampHeader: 'x-helpan-timestamp',
      fetch: capturingFetch(captured),
    });
    const out = await d.dispatch({
      ...makeInput('klokd'),
      targetOperation: 'klokd.write.shift_signup',
    });
    expect(out.status).toBe('completed');

    const req = captured[0]!;
    const path = '/api/v1/agents/dispatch/klokd.write.shift_signup';
    expect(req.url).toBe(`https://octopus.example${path}`);

    const parsed = parseAuthorizationHeader(req.headers['authorization']!);
    expect(parsed!.railPrefix).toBe('Helpan');
    const canonical = buildCanonicalString({
      method: 'POST',
      pathAndQuery: path,
      contentType: 'application/json',
      timestamp: req.headers['x-helpan-timestamp']!,
      bodySha256Hex: sha256Hex(req.body),
    });
    expect(verifyHmac(canonical, SECRET, parsed!.signature)).toBe(true);
  });

  it('URL-encodes an operation that carries path-unsafe characters', async () => {
    const captured: Captured[] = [];
    const d = createHttpDispatcher({
      rail: 'klokd',
      baseUrl: 'https://octopus.example',
      dispatchPath: '/api/v1/agents/dispatch/{operation}',
      appId: 'helpan_ai',
      hmacSecret: SECRET,
      timestampHeader: 'x-helpan-timestamp',
      fetch: capturingFetch(captured),
    });
    await d.dispatch({ ...makeInput('klokd'), targetOperation: '../admin' });
    expect(captured[0]!.url).toBe('https://octopus.example/api/v1/agents/dispatch/..%2Fadmin');
  });

  it('surfaces a non-2xx as failed with an HTTP-derived code', async () => {
    const d = createHttpDispatcher({
      rail: 'todoku',
      baseUrl: 'https://target.example',
      dispatchPath: '/v1/dispatch',
      appId: 'helpan_ai',
      hmacSecret: SECRET,
      timestampHeader: 'x-todoku-timestamp',
      fetch: capturingFetch([], 503),
    });
    const out = await d.dispatch(makeInput('todoku'));
    expect(out.status).toBe('failed');
  });
});
