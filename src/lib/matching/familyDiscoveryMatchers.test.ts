/**
 * Unit tests for the family-discovery matchers (H-12).
 * Two matchers in one suite: fresh_arrivals + basket_auto_refill.
 */

import { describe, expect, it } from 'vitest';
import {
  isBasketRefillBriefing,
  isFreshArrivalsBriefing,
  matchBasketRefillBriefing,
  matchFreshArrivalsBriefing,
} from './familyDiscoveryMatchers.js';
import type { MatchableBriefing, MatchableEvent } from './engine.js';

const ORIGIN = { lat: -1.2921, lng: 36.8219 }; // Nairobi CBD
const NEAR = { lat: -1.295, lng: 36.82 };
const FAR = { lat: -1.35, lng: 36.65 };

function briefing(intent: Record<string, unknown>): MatchableBriefing {
  return {
    id: 'brf_fd',
    accountUuid: 'acc_test',
    appId: 'family_discovery',
    briefingType: 'alert',
    intent,
  };
}

function event(
  type: string,
  payload: Record<string, unknown>
): MatchableEvent {
  return {
    id: 'evt_test',
    eventType: type,
    appId: 'family_discovery',
    accountUuid: 'acc_test',
    payload,
  };
}

// ---- discriminators --------------------------------------------------------

describe('isFreshArrivalsBriefing / isBasketRefillBriefing', () => {
  it('discriminates by intent.domain', () => {
    expect(
      isFreshArrivalsBriefing(briefing({ domain: 'family_discovery.fresh_arrivals' }))
    ).toBe(true);
    expect(
      isBasketRefillBriefing(briefing({ domain: 'family_discovery.basket_auto_refill' }))
    ).toBe(true);
    expect(isFreshArrivalsBriefing(briefing({ domain: 'klokd.shift_search' }))).toBe(false);
    expect(isBasketRefillBriefing(briefing({ domain: 'family_discovery.fresh_arrivals' }))).toBe(false);
  });
});

// ---- fresh_arrivals --------------------------------------------------------

describe('matchFreshArrivalsBriefing', () => {
  it('matches when every constraint is satisfied', () => {
    const b = briefing({
      domain: 'family_discovery.fresh_arrivals',
      categories: ['fresh_fish', 'vegetables'],
      max_distance_km: 2,
      origin: ORIGIN,
      time_window: { start: '06:00', end: '18:00', tz: 'Africa/Nairobi' },
      max_price_minor: 100000,
    });
    const e = event('family_discovery.listing_arrived', {
      listing_id: 'lst_1',
      category: 'fresh_fish',
      location: NEAR,
      arrived_at: '2026-05-21T09:00:00+03:00', // 09:00 Nairobi
      price_minor: 80000,
    });
    const m = matchFreshArrivalsBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.detail['match_kind']).toBe('family_discovery_fresh_arrivals');
    expect(m!.detail['listing_id']).toBe('lst_1');
    expect((m!.detail['reasons'] as string[])).toEqual([
      'category_in_whitelist',
      'within_max_distance_km',
      'within_time_window',
      'within_max_price_minor',
    ]);
  });

  it('rejects on category mismatch', () => {
    const b = briefing({
      domain: 'family_discovery.fresh_arrivals',
      categories: ['vegetables'],
    });
    expect(
      matchFreshArrivalsBriefing(b, event('x', { category: 'electronics' }))
    ).toBeNull();
  });

  it('rejects when distance exceeds the ceiling', () => {
    const b = briefing({
      domain: 'family_discovery.fresh_arrivals',
      max_distance_km: 2,
      origin: ORIGIN,
    });
    expect(matchFreshArrivalsBriefing(b, event('x', { location: FAR }))).toBeNull();
  });

  it('rejects when price exceeds the ceiling', () => {
    const b = briefing({
      domain: 'family_discovery.fresh_arrivals',
      max_price_minor: 50000,
    });
    expect(
      matchFreshArrivalsBriefing(b, event('x', { price_minor: 75000 }))
    ).toBeNull();
  });

  it('rejects when time window is set but price_minor missing (defensive)', () => {
    const b = briefing({
      domain: 'family_discovery.fresh_arrivals',
      max_price_minor: 50000,
    });
    expect(
      matchFreshArrivalsBriefing(b, event('x', { /* no price */ }))
    ).toBeNull();
  });

  it('skips axis checks for which the briefing has no constraint', () => {
    const b = briefing({ domain: 'family_discovery.fresh_arrivals' });
    expect(
      matchFreshArrivalsBriefing(b, event('x', { category: 'anything' }))
    ).not.toBeNull();
  });
});

// ---- basket_auto_refill ----------------------------------------------------

describe('matchBasketRefillBriefing', () => {
  it('matches a basket within all constraints', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      schedule: '0 14 * * 0',
      merchant_ids: ['mer_njeri', 'mer_powermama'],
      items: [
        { sku: 'tomatoes_2kg', max_price_minor: 30000 },
        { sku: 'milk_1l', max_price_minor: 15000 },
      ],
      max_total_minor: 250000,
    });
    const e = event('family_discovery.basket_tick', {
      basket_id: 'bkt_1',
      merchant_id: 'mer_njeri',
      line_items: [
        { sku: 'tomatoes_2kg', price_minor: 28000, qty: 1 },
        { sku: 'milk_1l', price_minor: 14000, qty: 2 },
      ],
      total_minor: 56000,
    });
    const m = matchBasketRefillBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.detail['match_kind']).toBe('family_discovery_basket_auto_refill');
    expect(m!.detail['basket_id']).toBe('bkt_1');
    expect(m!.detail['merchant_id']).toBe('mer_njeri');
    expect(m!.detail['total_minor']).toBe(56000);
  });

  it('rejects when the basket merchant is not in the allowlist', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      merchant_ids: ['mer_njeri'],
    });
    expect(
      matchBasketRefillBriefing(
        b,
        event('x', {
          merchant_id: 'mer_other',
          line_items: [{ sku: 'tomatoes_2kg', price_minor: 30000 }],
        })
      )
    ).toBeNull();
  });

  it('rejects on unrecognised SKU even if everything else fits', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      merchant_ids: ['mer_njeri'],
      items: [{ sku: 'tomatoes_2kg', max_price_minor: 30000 }],
      max_total_minor: 250000,
    });
    expect(
      matchBasketRefillBriefing(
        b,
        event('x', {
          merchant_id: 'mer_njeri',
          line_items: [{ sku: 'wine_750ml', price_minor: 100000 }],
          total_minor: 100000,
        })
      )
    ).toBeNull();
  });

  it('rejects when a recognised SKU exceeds its per-line ceiling', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      merchant_ids: ['mer_njeri'],
      items: [{ sku: 'tomatoes_2kg', max_price_minor: 30000 }],
      max_total_minor: 250000,
    });
    expect(
      matchBasketRefillBriefing(
        b,
        event('x', {
          merchant_id: 'mer_njeri',
          line_items: [{ sku: 'tomatoes_2kg', price_minor: 50000 }],
          total_minor: 50000,
        })
      )
    ).toBeNull();
  });

  it('rejects when basket total exceeds max_total_minor', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      merchant_ids: ['mer_njeri'],
      items: [{ sku: 'tomatoes_2kg', max_price_minor: 30000 }],
      max_total_minor: 50000,
    });
    expect(
      matchBasketRefillBriefing(
        b,
        event('x', {
          merchant_id: 'mer_njeri',
          line_items: [
            { sku: 'tomatoes_2kg', price_minor: 30000 },
            { sku: 'tomatoes_2kg', price_minor: 30000 },
          ],
          total_minor: 60000,
        })
      )
    ).toBeNull();
  });

  it('rejects an empty basket (no line items)', () => {
    const b = briefing({
      domain: 'family_discovery.basket_auto_refill',
      merchant_ids: ['mer_njeri'],
    });
    expect(
      matchBasketRefillBriefing(
        b,
        event('x', { merchant_id: 'mer_njeri', line_items: [], total_minor: 0 })
      )
    ).toBeNull();
  });
});
