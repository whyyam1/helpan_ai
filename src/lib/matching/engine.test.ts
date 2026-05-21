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

  // H-9 — strategy routing
  it('routes klokd.shift_search briefings to the Klokd matcher (not generic)', () => {
    const event: MatchableEvent = {
      id: 'evt_klokd',
      eventType: 'klokd.shift_offer',
      appId: 'klokd',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: {
        shift_id: 'shf_1',
        category: 'hospitality',
        pay_minor: 100000,
      },
    };
    const klokdBriefing: MatchableBriefing = {
      id: 'brf_klokd',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'klokd',
      briefingType: 'alert',
      intent: {
        domain: 'klokd.shift_search',
        categories: ['hospitality'],
        min_pay_minor: 80000,
        // No `match` key on purpose — the generic matcher would not fire.
      },
    };
    const results = matchEventAgainstBriefings(event, [klokdBriefing]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('klokd_shift_search');
  });

  it('a klokd briefing whose conditions are not met returns no match', () => {
    const event: MatchableEvent = {
      id: 'evt_klokd',
      eventType: 'klokd.shift_offer',
      appId: 'klokd',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: { category: 'construction', pay_minor: 10000 },
    };
    const klokdBriefing: MatchableBriefing = {
      id: 'brf_klokd',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'klokd',
      briefingType: 'alert',
      intent: {
        domain: 'klokd.shift_search',
        categories: ['hospitality'],
        min_pay_minor: 80000,
      },
    };
    expect(matchEventAgainstBriefings(event, [klokdBriefing])).toHaveLength(0);
  });

  it('routes family_discovery.fresh_arrivals to the family-discovery matcher', () => {
    const event: MatchableEvent = {
      id: 'evt_fresh',
      eventType: 'family_discovery.listing_arrived',
      appId: 'family_discovery',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: { category: 'fresh_fish', price_minor: 50000 },
    };
    const fresh: MatchableBriefing = {
      id: 'brf_fresh',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'family_discovery',
      briefingType: 'alert',
      intent: {
        domain: 'family_discovery.fresh_arrivals',
        categories: ['fresh_fish'],
        max_price_minor: 100000,
      },
    };
    const results = matchEventAgainstBriefings(event, [fresh]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('family_discovery_fresh_arrivals');
  });

  it('routes family_discovery.basket_auto_refill to the basket matcher', () => {
    const event: MatchableEvent = {
      id: 'evt_basket',
      eventType: 'family_discovery.basket_tick',
      appId: 'family_discovery',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: {
        merchant_id: 'mer_x',
        line_items: [{ sku: 'tomatoes_2kg', price_minor: 25000 }],
        total_minor: 25000,
      },
    };
    const basket: MatchableBriefing = {
      id: 'brf_basket',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'family_discovery',
      briefingType: 'standing_basket',
      intent: {
        domain: 'family_discovery.basket_auto_refill',
        merchant_ids: ['mer_x'],
        items: [{ sku: 'tomatoes_2kg', max_price_minor: 30000 }],
        max_total_minor: 100000,
      },
    };
    const results = matchEventAgainstBriefings(event, [basket]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('family_discovery_basket_auto_refill');
  });

  it('routes chapaa.round_up_offer briefings to the Chapaa round-up matcher', () => {
    const event: MatchableEvent = {
      id: 'evt_debit',
      eventType: 'kp.wallet.debited',
      appId: 'chapaa',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: { amount_minor: 484700 },
    };
    const roundUp: MatchableBriefing = {
      id: 'brf_roundup',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'chapaa',
      briefingType: 'alert',
      intent: { domain: 'chapaa.round_up_offer', max_round_up_minor: 20000 },
    };
    const results = matchEventAgainstBriefings(event, [roundUp]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('chapaa_round_up_offer');
    expect(results[0]!.detail['computed_round_up_minor']).toBe(5300);
  });

  it('routes chapaa.goal_acceleration briefings to the goal matcher', () => {
    const event: MatchableEvent = {
      id: 'evt_pace',
      eventType: 'chapaa.goal_pace',
      appId: 'chapaa',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: { goal_id: 'goal_x', signal: 'weekly_pace_below_target' },
    };
    const goalBrief: MatchableBriefing = {
      id: 'brf_goal',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'chapaa',
      briefingType: 'threshold_watch',
      intent: {
        domain: 'chapaa.goal_acceleration',
        goal_id: 'goal_x',
        alert_when: 'weekly_pace_below_target',
      },
    };
    const results = matchEventAgainstBriefings(event, [goalBrief]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('chapaa_goal_acceleration');
  });

  it('routes lunchdrop.weekly_plan briefings to the Lunch Drop matcher', () => {
    const event: MatchableEvent = {
      id: 'evt_lunch',
      eventType: 'lunchdrop.offer',
      appId: 'lunchdrop',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      payload: {
        merchant_id: 'mer_powermama',
        items: [{ name: 'chapati' }],
        total_minor: 40000,
      },
    };
    const planBriefing: MatchableBriefing = {
      id: 'brf_plan',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'lunchdrop',
      briefingType: 'scheduled_action',
      intent: {
        domain: 'lunchdrop.weekly_plan',
        merchant_id: 'mer_powermama',
        menu_preference: ['chapati'],
        max_per_order_minor: 80000,
      },
    };
    const results = matchEventAgainstBriefings(event, [planBriefing]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('lunchdrop_weekly_plan');
  });

  it('an unknown domain falls back to the generic matcher', () => {
    const event = makeEvent({ merchant_id: 'mer_abc' });
    const briefingUnknownDomain: MatchableBriefing = {
      id: 'brf_unknown',
      accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
      appId: 'lunchdrop',
      briefingType: 'alert',
      // Domain set to something the router doesn't know → generic fallback.
      intent: { domain: 'unregistered.domain', match: { merchant_id: 'mer_abc' } },
    };
    const results = matchEventAgainstBriefings(event, [briefingUnknownDomain]);
    expect(results).toHaveLength(1);
    expect(results[0]!.detail['match_kind']).toBe('generic_key_equality');
  });
});
