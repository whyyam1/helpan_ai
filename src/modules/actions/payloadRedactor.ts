/**
 * Payload redaction for the dispatch path (H-4).
 *
 * Reboot Pack v1.2 §9.5: actions persist a **redacted** copy of the request
 * payload. No PII, no full PANs, no plaintext phone numbers, no full email
 * addresses. The `audit_log.detail` column likewise stores only the redacted
 * shape — the authoritative compliance record is the audit chain, not the
 * actions table.
 *
 * Heuristics (deliberately conservative — over-redact, never under-redact):
 *
 *   - Keys containing `phone`, `msisdn`, `mobile`, `email`, `pan`,
 *     `card`, `cvv`, `pin`, `password`, `secret`, `token`, `ssn`,
 *     `national_id`, `passport`, `address`, `dob`, `birth` →
 *     replaced with `[REDACTED]`.
 *   - Phone-like values (8+ consecutive digits, possibly with `+` `-` ` `):
 *     replaced with `[REDACTED:phone]` regardless of key name.
 *   - Email-like values (`x@y.tld`): replaced with `[REDACTED:email]`.
 *   - PAN-like values (13–19 contiguous digits): replaced with `[REDACTED:pan]`.
 *   - Top-level monetary keys (`amount_minor`, `currency`, `quantity`,
 *     `unit_price_minor`) pass through — these are needed for downstream
 *     reconciliation and don't carry PII.
 *
 * Apply once at dispatch ingress; downstream code only sees the redacted
 * shape. The original is forwarded to the target rail (the dispatcher does
 * not call this redactor — only the rail's persistence layer does).
 */

const PII_KEY_REGEX =
  /(phone|msisdn|mobile|email|pan|card|cvv|pin|password|secret|token|ssn|national_id|passport|address|dob|birth)/i;

const PHONE_VALUE_REGEX = /(?<!\d)(?:\+?\d[\s-]?){8,}/;
const EMAIL_VALUE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_VALUE_REGEX = /^\d{13,19}$/;

/**
 * Maximum recursion depth — anything deeper is replaced wholesale.
 * Defends against pathological payloads.
 */
const MAX_DEPTH = 6;

export function redactPayload(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    // Top level isn't an object → wrap so the redacted shape stays an object
    // (matches the `request_payload` JSONB column type).
    return { value: redactValue(input, 0) };
  }
  return redactObject(input as Record<string, unknown>, 0);
}

function redactObject(
  obj: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) return { _redacted: '[DEEP]' };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEY_REGEX.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactValue(v, depth + 1);
  }
  return out;
}

function redactValue(v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return redactString(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v;
  if (Array.isArray(v)) return v.map((item) => redactValue(item, depth + 1));
  if (typeof v === 'object') return redactObject(v as Record<string, unknown>, depth);
  return '[REDACTED:unknown]';
}

function redactString(s: string): string {
  if (s.length > 4096) return '[REDACTED:large_string]';
  if (EMAIL_VALUE_REGEX.test(s)) return '[REDACTED:email]';
  if (PAN_VALUE_REGEX.test(s.replaceAll(/\s/g, ''))) return '[REDACTED:pan]';
  if (PHONE_VALUE_REGEX.test(s)) return '[REDACTED:phone]';
  return s;
}
