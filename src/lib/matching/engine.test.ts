import { describe, it, expect } from 'vitest';
import {
  matchEventAgainstBriefings,
  type MatchableBriefing,
  type MatchableEvent,
} from './engine.js';

function makeEvent(payload: Record<string, unknown>): MatchableEvent {
  return {
    id: 'evt_01TEST00000000000000000000',
    eventType: 'lunchdrop.zone_feed.broadcast',
    appId: 'lunchdrop',
    accountUuid: null,
    payload,
  };
}

function makeBriefing(
  id: string,
  intent: Record<string, unknown>
): MatchableBriefing {
  return {
    id,
    accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
    appId: 'lunchdrop',
    briefingType: 'alert',
    intent,
  };
}

describe('matchEventAgainstBriefings', () => {
  it('matches when every key in intent.match is equal in payload', () => {
    const event = makeEvent({ merchant_id: 'mer_abc', cuisine: 'mama' });
    const brief = makeBriefing('brf_a', { match: { merchant_id: 'mer_abc' } });
    const matches = matchEventAgainstBriefings(event, [brief]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.briefingId).toBe('brf_a');
    expect(matches[0]?.confidence).toBe('high');
  });

  it('does not match when a key in intent.match is missing from payload', () => {
    const event = makeEvent({ merchant_id: 'mer_abc' });
    const brief = makeBriefing('brf_a', {
      match: { merchant_id: 'mer_abc', cuisine: 'mama' },
    });
    expect(matchEventAgainstBriefings(event, [brief])).toHaveLength(0);
  });

  it('does not match when a value differs', () => {
    const event = makeEvent({ merchant_id: 'mer_abc', cuisine: 'pizza' });
    const brief = makeBriefing('brf_a', {
      match: { merchant_id: 'mer_abc', cuisine: 'mama' },
    });
    expect(matchEventAgainstBriefings(event, [brief])).toHaveLength(0);
  });

  it('treats nested objects with deep equality (subset semantics only at top level)', () => {
    const event = makeEvent({ filter: { area: 'kilimani', radius_m: 1000 } });
    const matchSame = makeBriefing('brf_same', {
      match: { filter: { area: 'kilimani', radius_m: 1000 } },
    });
    const matchPartial = makeBriefing('brf_partial', {
      match: { filter: { area: 'kilimani' } }, // missing radius_m → not deep-equal
    });
    const results = matchEventAgainstBriefings(event, [matchSame, matchPartial]);
    expect(results.map((r) => r.briefingId)).toEqual(['brf_same']);
  });

  it('matches array values when ordered identically', () => {
    const event = makeEvent({ tags: ['a', 'b'] });
    const brief = makeBriefing('brf_a', { match: { tags: ['a', 'b'] } });
    expect(matchEventAgainstBriefings(event, [brief])).toHaveLength(1);
  });

  it('does not match arrays with different order', () => {
    const event = makeEvent({ tags: ['a', 'b'] });
    const brief = makeBriefing('brf_a', { match: { tags: ['b', 'a'] } });
    expect(matchEventAgainstBriefings(event, [brief])).toHaveLength(0);
  });

  it('skips briefings whose intent has no `match` predicate (no fuzzy fallback at H-5)', () => {
    const event = makeEvent({ merchant_id: 'mer_abc' });
    const noMatch = makeBriefing('brf_no_match', { threshold: 100 });
    const empty = makeBriefing('brf_empty', {});
    const wrongType = makeBriefing('brf_wrong_type', { match: 'not-an-object' });
    expect(matchEventAgainstBriefings(event, [noMatch, empty, wrongType])).toHaveLength(0);
  });

  it('returns multiple matches when several briefings hit the same event', () => {
    const event = makeEvent({ merchant_id: 'mer_abc', cuisine: 'mama' });
    const a = makeBriefing('brf_a', { match: { merchant_id: 'mer_abc' } });
    const b = makeBriefing('brf_b', { match: { cuisine: 'mama' } });
    const c = makeBriefing('brf_c', {
      match: { merchant_id: 'mer_abc', cuisine: 'mama' },
    });
    const results = matchEventAgainstBriefings(event, [a, b, c]);
    expect(results.map((r) => r.briefingId).sort()).toEqual(['brf_a', 'brf_b', 'brf_c']);
  });

  it('detail captures match metadata for the audit + webhook payload', () => {
    const event = makeEvent({ x: 1, y: 2 });
    const brief = makeBriefing('brf_a', { match: { x: 1, y: 2 } });
    const [m] = matchEventAgainstBriefings(event, [brief]);
    expect(m?.detail).toMatchObject({
      match_kind: 'generic_key_equality',
      predicate_keys: ['x', 'y'],
      briefing_type: 'alert',
      event_type: 'lunchdrop.zone_feed.broadcast',
    });
  });

  it('returns empty when given empty briefings list', () => {
    expect(matchEventAgainstBriefings(makeEvent({ a: 1 }), [])).toHaveLength(0);
  });
});
