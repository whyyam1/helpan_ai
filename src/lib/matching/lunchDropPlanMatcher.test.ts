/**
 * Unit tests for the Lunch Drop `weekly_plan` matcher (H-10).
 */

import { describe, expect, it } from 'vitest';
import {
  isLunchDropPlanBriefing,
  matchLunchDropPlanBriefing,
} from './lunchDropPlanMatcher.js';
import type { MatchableBriefing, MatchableEvent } from './engine.js';

function briefing(intent: Record<string, unknown>): MatchableBriefing {
  return {
    id: 'brf_lunch',
    accountUuid: 'acc_test',
    appId: 'lunchdrop',
    briefingType: 'scheduled_action',
    intent: { domain: 'lunchdrop.weekly_plan', ...intent },
  };
}

function event(payload: Record<string, unknown>): MatchableEvent {
  return {
    id: 'evt_offer',
    eventType: 'lunchdrop.offer',
    appId: 'lunchdrop',
    accountUuid: 'acc_test',
    payload,
  };
}

describe('isLunchDropPlanBriefing', () => {
  it('returns true for the lunchdrop.weekly_plan domain only', () => {
    expect(isLunchDropPlanBriefing(briefing({}))).toBe(true);
    expect(
      isLunchDropPlanBriefing({
        id: 'brf',
        accountUuid: 'a',
        appId: 'klokd',
        briefingType: 'alert',
        intent: { domain: 'klokd.shift_search' },
      })
    ).toBe(false);
  });
});

describe('matchLunchDropPlanBriefing', () => {
  it('matches when every condition is satisfied (primary merchant)', () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      fallback_merchant_ids: ['mer_njeri'],
      menu_preference: ['chapati', 'stew'],
      max_per_order_minor: 80000,
    });
    const e = event({
      order_id: 'ord_1',
      merchant_id: 'mer_powermama',
      items: [
        { name: 'Chapati', qty: 2, unit_price_minor: 25000 },
        { name: 'Soda', qty: 1, unit_price_minor: 15000 },
      ],
      total_minor: 65000,
    });
    const m = matchLunchDropPlanBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.detail['match_kind']).toBe('lunchdrop_weekly_plan');
    expect(m!.detail['merchant_matched_as']).toBe('primary');
    expect(m!.detail['reasons']).toEqual([
      'merchant_primary',
      'menu_preference_hit',
      'within_max_per_order_minor',
    ]);
    expect(m!.detail['order_id']).toBe('ord_1');
  });

  it("matches a fallback merchant when the primary isn't the offerer", () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      fallback_merchant_ids: ['mer_njeri', 'mer_kibanda'],
      menu_preference: ['stew'],
    });
    const e = event({
      merchant_id: 'mer_njeri',
      items: [{ name: 'stew', unit_price_minor: 30000 }],
    });
    const m = matchLunchDropPlanBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.detail['merchant_matched_as']).toBe('fallback');
    expect((m!.detail['reasons'] as string[])).toContain('merchant_fallback');
  });

  it('rejects when the merchant is neither primary nor in the fallback set', () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      fallback_merchant_ids: ['mer_njeri'],
    });
    expect(
      matchLunchDropPlanBriefing(b, event({ merchant_id: 'mer_strange' }))
    ).toBeNull();
  });

  it('rejects when no menu item hits the preference list', () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      menu_preference: ['chapati', 'stew'],
    });
    expect(
      matchLunchDropPlanBriefing(
        b,
        event({
          merchant_id: 'mer_powermama',
          items: [{ name: 'pizza' }, { name: 'salad' }],
        })
      )
    ).toBeNull();
  });

  it('matches case-insensitively on menu items', () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      menu_preference: ['Chapati'],
    });
    const m = matchLunchDropPlanBriefing(
      b,
      event({
        merchant_id: 'mer_powermama',
        items: [{ name: 'CHAPATI' }],
      })
    );
    expect(m).not.toBeNull();
  });

  it('rejects when total_minor exceeds max_per_order_minor', () => {
    const b = briefing({
      merchant_id: 'mer_powermama',
      max_per_order_minor: 50000,
    });
    expect(
      matchLunchDropPlanBriefing(
        b,
        event({ merchant_id: 'mer_powermama', total_minor: 75000 })
      )
    ).toBeNull();
  });

  it('skips the merchant axis when neither merchant_id nor fallbacks set', () => {
    const b = briefing({ max_per_order_minor: 50000 });
    const m = matchLunchDropPlanBriefing(
      b,
      event({ merchant_id: 'mer_anything', total_minor: 40000 })
    );
    expect(m).not.toBeNull();
    expect(m!.detail['reasons']).not.toContain('merchant_primary');
    expect(m!.detail['reasons']).not.toContain('merchant_fallback');
  });

  it('skips menu axis when menu_preference is absent', () => {
    const b = briefing({ merchant_id: 'mer_x' });
    expect(
      matchLunchDropPlanBriefing(
        b,
        event({ merchant_id: 'mer_x', items: [{ name: 'anything' }] })
      )
    ).not.toBeNull();
  });

  it('rejects when max_per_order_minor set but total_minor missing from event', () => {
    const b = briefing({ merchant_id: 'mer_x', max_per_order_minor: 50000 });
    expect(
      matchLunchDropPlanBriefing(b, event({ merchant_id: 'mer_x' }))
    ).toBeNull();
  });
});
