import { describe, expect, it } from 'vitest';
import { generateTraceparent, parseTraceparent } from './trace.js';

describe('generateTraceparent', () => {
  it('emits a well-formed traceparent', () => {
    const tp = generateTraceparent();
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('produces a different trace_id each call', () => {
    expect(generateTraceparent()).not.toBe(generateTraceparent());
  });
});

describe('parseTraceparent', () => {
  it('round-trips a generated traceparent', () => {
    const tp = generateTraceparent();
    const parsed = parseTraceparent(tp);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe('00');
    expect(parsed!.flags).toBe('01');
    expect(parsed!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed!.parentId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects malformed input', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-too-short-01')).toBeNull();
  });

  it('rejects forbidden version ff', () => {
    const traceId = 'a'.repeat(32);
    const parentId = 'b'.repeat(16);
    expect(parseTraceparent(`ff-${traceId}-${parentId}-01`)).toBeNull();
  });

  it('rejects all-zero traceId or parentId', () => {
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`)).toBeNull();
    expect(parseTraceparent(`00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`)).toBeNull();
  });
});
