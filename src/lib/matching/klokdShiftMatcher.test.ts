/**
 * Unit tests for the Klokd `shift_search` matcher (H-9). Closes RECAP §6.6.
 */

import { describe, expect, it } from 'vitest';
import {
  haversineKm,
  matchKlokdShiftBriefing,
  minutesInWindow,
  minutesOfDayInZone,
  parseHhmm,
  isKlokdShiftBriefing,
} from './klokdShiftMatcher.js';
import type { MatchableBriefing, MatchableEvent } from './engine.js';

// ---- Pure helpers ----------------------------------------------------------

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(-1.2921, 36.8219, -1.2921, 36.8219)).toBeCloseTo(0, 5);
  });

  it('returns a sensible value for two known points (Nairobi CBD → Westlands)', () => {
    // Nairobi CBD ~(-1.2921, 36.8219); Westlands ~(-1.2670, 36.8108).
    // Straight-line ~3 km.
    const d = haversineKm(-1.2921, 36.8219, -1.2670, 36.8108);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(3.5);
  });

  it('is symmetric', () => {
    const a = haversineKm(-1.29, 36.82, -1.26, 36.81);
    const b = haversineKm(-1.26, 36.81, -1.29, 36.82);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('parseHhmm', () => {
  it('parses well-formed values', () => {
    expect(parseHhmm('00:00')).toBe(0);
    expect(parseHhmm('18:00')).toBe(18 * 60);
    expect(parseHhmm('23:59')).toBe(23 * 60 + 59);
  });

  it('rejects malformed values', () => {
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('07:60')).toBeNull();
    expect(parseHhmm('7:30')).toBeNull();
    expect(parseHhmm('')).toBeNull();
    expect(parseHhmm('hello')).toBeNull();
  });
});

describe('minutesInWindow', () => {
  it('handles the simple case (start ≤ end)', () => {
    expect(minutesInWindow(12 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(minutesInWindow(8 * 60, 9 * 60, 17 * 60)).toBe(false);
    expect(minutesInWindow(18 * 60, 9 * 60, 17 * 60)).toBe(false);
    // Boundary inclusive
    expect(minutesInWindow(9 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(minutesInWindow(17 * 60, 9 * 60, 17 * 60)).toBe(true);
  });

  it('wraps past midnight when start > end', () => {
    // 22:00 → 02:00
    const s = 22 * 60;
    const e = 2 * 60;
    expect(minutesInWindow(23 * 60 + 30, s, e)).toBe(true); // 23:30
    expect(minutesInWindow(0, s, e)).toBe(true); // 00:00
    expect(minutesInWindow(1 * 60 + 15, s, e)).toBe(true); // 01:15
    expect(minutesInWindow(12 * 60, s, e)).toBe(false); // 12:00
    expect(minutesInWindow(21 * 60 + 59, s, e)).toBe(false); // 21:59
  });
});

describe('minutesOfDayInZone', () => {
  it('converts UTC instant to a local minute-of-day in EAT (UTC+3)', () => {
    // 18:00 UTC == 21:00 in Africa/Nairobi
    const utc = new Date('2026-05-21T18:00:00Z');
    expect(minutesOfDayInZone(utc, 'Africa/Nairobi')).toBe(21 * 60);
  });

  it('handles the new-day rollover in EAT', () => {
    // 22:30 UTC == 01:30 next day in Africa/Nairobi
    const utc = new Date('2026-05-21T22:30:00Z');
    expect(minutesOfDayInZone(utc, 'Africa/Nairobi')).toBe(1 * 60 + 30);
  });
});

// ---- Briefing matcher ------------------------------------------------------

const ORIGIN = { lat: -1.2921, lng: 36.8219 }; // Nairobi CBD
const NEAR = { lat: -1.2950, lng: 36.8200 }; // ~0.4 km away
const FAR = { lat: -1.3500, lng: 36.6500 }; // ~25+ km away

function briefing(intent: Record<string, unknown>): MatchableBriefing {
  return {
    id: 'brf_test',
    accountUuid: 'acc_test',
    appId: 'klokd',
    briefingType: 'alert',
    intent: { domain: 'klokd.shift_search', ...intent },
  };
}

function event(payload: Record<string, unknown>): MatchableEvent {
  return {
    id: 'evt_test',
    eventType: 'klokd.shift_offer',
    appId: 'klokd',
    accountUuid: 'acc_test',
    payload,
  };
}

describe('isKlokdShiftBriefing', () => {
  it('returns true only for the klokd.shift_search domain', () => {
    expect(isKlokdShiftBriefing(briefing({}))).toBe(true);
    const other = {
      id: 'brf_x',
      accountUuid: 'acc_x',
      appId: 'chapaa',
      briefingType: 'alert',
      intent: { domain: 'chapaa.something_else' },
    };
    expect(isKlokdShiftBriefing(other)).toBe(false);
  });
});

describe('matchKlokdShiftBriefing', () => {
  it('matches when every condition is satisfied', () => {
    const b = briefing({
      categories: ['hospitality', 'retail'],
      max_distance_km: 5,
      origin: ORIGIN,
      time_window: { start: '18:00', end: '23:59', tz: 'Africa/Nairobi' },
      min_pay_minor: 80000,
    });
    const e = event({
      shift_id: 'shf_1',
      category: 'hospitality',
      location: NEAR,
      start_time: '2026-05-21T18:00:00+03:00', // 18:00 Nairobi
      pay_minor: 100000,
    });
    const m = matchKlokdShiftBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe('high');
    expect(m!.detail['match_kind']).toBe('klokd_shift_search');
    expect(m!.detail['reasons']).toEqual([
      'category_in_whitelist',
      'within_max_distance_km',
      'within_time_window',
      'min_pay_minor_met',
    ]);
    expect(m!.detail['shift_id']).toBe('shf_1');
  });

  it('rejects on category mismatch', () => {
    const b = briefing({ categories: ['hospitality'] });
    expect(
      matchKlokdShiftBriefing(b, event({ category: 'construction', pay_minor: 100000 }))
    ).toBeNull();
  });

  it('rejects when distance exceeds max_distance_km', () => {
    const b = briefing({
      max_distance_km: 5,
      origin: ORIGIN,
    });
    expect(matchKlokdShiftBriefing(b, event({ location: FAR }))).toBeNull();
  });

  it('skips distance check when briefing has no origin', () => {
    const b = briefing({ max_distance_km: 5 });
    // Far location, but no origin → distance check skipped → match.
    const m = matchKlokdShiftBriefing(b, event({ location: FAR }));
    expect(m).not.toBeNull();
    expect(m!.detail['reasons']).not.toContain('within_max_distance_km');
    expect(m!.detail['distance_km']).toBeUndefined();
  });

  it('rejects on pay floor', () => {
    const b = briefing({ min_pay_minor: 80000 });
    expect(matchKlokdShiftBriefing(b, event({ pay_minor: 50000 }))).toBeNull();
  });

  it('rejects when event time falls outside the briefing window (Nairobi tz)', () => {
    const b = briefing({
      time_window: { start: '18:00', end: '23:59', tz: 'Africa/Nairobi' },
    });
    // 10:00 Nairobi = 07:00 UTC.
    expect(
      matchKlokdShiftBriefing(b, event({ start_time: '2026-05-21T07:00:00Z' }))
    ).toBeNull();
  });

  it('matches a cross-midnight time window', () => {
    const b = briefing({
      time_window: { start: '22:00', end: '02:00', tz: 'Africa/Nairobi' },
    });
    // 23:30 Nairobi == 20:30 UTC
    const m = matchKlokdShiftBriefing(
      b,
      event({ start_time: '2026-05-21T20:30:00Z' })
    );
    expect(m).not.toBeNull();
  });
});
