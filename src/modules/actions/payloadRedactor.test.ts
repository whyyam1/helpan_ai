/**
 * Unit tests for the dispatch-payload PII redactor (H-4).
 * Reboot Pack §9.5: no PII / no PANs / no plaintext phone numbers in
 * `actions.request_payload_redacted` or `audit_log.detail`.
 */

import { describe, expect, it } from 'vitest';
import { redactPayload } from './payloadRedactor.js';

describe('redactPayload', () => {
  it('replaces PII-named keys with [REDACTED] regardless of value', () => {
    const out = redactPayload({
      recipient_phone: '+254712345678',
      recipient_email: 'alice@example.com',
      pan: '4111111111111111',
      cvv: '123',
      pin: '0000',
      password: 'whatever',
      secret: 'whatever',
      auth_token: 'tk_abc',
      ssn: '123-45-6789',
      national_id: '12345678',
      passport: 'A12345678',
      address: 'Westlands, Nairobi',
      dob: '1990-01-01',
      mother_birth_year: '1965',
    });
    for (const k of Object.keys(out)) {
      expect(out[k]).toBe('[REDACTED]');
    }
  });

  it('redacts phone-like values even under non-PII key names', () => {
    const out = redactPayload({ note: '+254 712 345 678 will pick up' });
    expect(out['note']).toBe('[REDACTED:phone]');
  });

  it('redacts email-like values under non-PII key names', () => {
    const out = redactPayload({ tag: 'someone@example.org' });
    expect(out['tag']).toBe('[REDACTED:email]');
  });

  it('redacts PAN-like values', () => {
    expect(redactPayload({ x: '4111111111111111' })['x']).toBe('[REDACTED:pan]');
    expect(redactPayload({ x: '378282246310005' })['x']).toBe('[REDACTED:pan]');
  });

  it('passes safe values through unchanged', () => {
    const out = redactPayload({
      amount_minor: 480_00,
      currency: 'KES',
      quantity: 2,
      merchant_id: 'mch_powermama',
      note: 'Lunch combo',
    });
    expect(out['amount_minor']).toBe(48000);
    expect(out['currency']).toBe('KES');
    expect(out['quantity']).toBe(2);
    expect(out['merchant_id']).toBe('mch_powermama');
    expect(out['note']).toBe('Lunch combo');
  });

  it('recurses into nested objects', () => {
    const out = redactPayload({
      order: {
        items: [{ sku: 'food.combo', qty: 2 }],
        delivery: { phone: '+254712000111', address: 'X' },
      },
    });
    expect(out['order']).toMatchObject({
      delivery: { phone: '[REDACTED]', address: '[REDACTED]' },
    });
  });

  it('wraps a non-object top-level payload so the result stays an object', () => {
    expect(redactPayload('hello').value).toBe('hello');
    expect(redactPayload(42).value).toBe(42);
    expect(redactPayload(null).value).toBeNull();
  });

  it('replaces extreme depth with a sentinel rather than stack-overflowing', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => redactPayload(deep)).not.toThrow();
  });
});
