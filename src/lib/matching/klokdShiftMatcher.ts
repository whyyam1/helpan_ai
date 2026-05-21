/**
 * Klokd type-aware matcher (H-9). Closes RECAP §6.6.
 *
 * Briefing intent shape (per per-app patterns §1.3):
 *
 *   {
 *     domain: "klokd.shift_search",
 *     categories: ["hospitality", "retail"],
 *     max_distance_km: 5,
 *     time_window: { start: "18:00", end: "23:59", tz: "Africa/Nairobi" },
 *     min_pay_minor: 80000,
 *     origin: { lat: -1.2921, lng: 36.8219 },   // optional — without it
 *                                                // the distance check is skipped
 *     auto_signup: false
 *   }
 *
 * Inbound event payload shape (the Klokd backend's shift_offered shape):
 *
 *   {
 *     shift_id: "shf_...",
 *     category: "hospitality",
 *     location: { lat: -1.292, lng: 36.821 },
 *     start_time: "2026-05-21T18:00:00+03:00",   // ISO 8601, tz-aware
 *     end_time:   "2026-05-21T23:00:00+03:00",
 *     pay_minor: 100000,
 *     employer_id: "emp_..."
 *   }
 *
 * Matcher contract:
 *   - All four conditions (category / distance / time / pay) are AND'd.
 *   - Each condition is skipped if the briefing intent omits the controlling
 *     field — a briefing can constrain on a subset of axes.
 *   - The distance check is also skipped when the briefing has no `origin`
 *     or the event has no `location` — surfaced in the match `detail` so the
 *     downstream observer knows the match was geo-degraded.
 *   - Times are evaluated in the briefing's tz; the event's `start_time`
 *     instant is converted to a local time-of-day in the briefing's tz and
 *     checked against the [start, end] window, with cross-midnight handling
 *     (start > end means the window wraps past 24:00).
 *
 * Returned `detail` is JSON-serialised onto the `briefing_matches` row + the
 * outbound webhook envelope.
 */

import type {
  BriefingMatch,
  MatchableBriefing,
  MatchableEvent,
} from './engine.js';

const KLOKD_DOMAIN = 'klokd.shift_search';

interface KlokdIntent {
  readonly domain?: string;
  readonly categories?: readonly string[];
  readonly max_distance_km?: number;
  readonly time_window?: {
    readonly start?: string;
    readonly end?: string;
    readonly tz?: string;
  };
  readonly min_pay_minor?: number;
  readonly origin?: { readonly lat?: number; readonly lng?: number };
}

interface KlokdShiftPayload {
  readonly shift_id?: string;
  readonly category?: string;
  readonly location?: { readonly lat?: number; readonly lng?: number };
  readonly start_time?: string;
  readonly pay_minor?: number;
  readonly employer_id?: string;
}

/** True iff this briefing's intent is targeted at the Klokd matcher. */
export function isKlokdShiftBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as KlokdIntent)['domain'] === KLOKD_DOMAIN;
}

/**
 * Evaluate one Klokd briefing against one event payload. Returns a
 * `BriefingMatch` on match, `null` otherwise.
 *
 * `nowMs` is injectable so tests don't depend on the wall clock — though
 * the matcher uses it only to evaluate cross-midnight windows when the
 * event's start_time is missing (defensive fallback).
 */
export function matchKlokdShiftBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent,
  nowMs: number = Date.now()
): BriefingMatch | null {
  const intent = briefing.intent as KlokdIntent;
  const payload = event.payload as KlokdShiftPayload;
  const reasons: string[] = [];

  // ---- Category whitelist ------------------------------------------------
  if (Array.isArray(intent.categories) && intent.categories.length > 0) {
    if (!payload.category || !intent.categories.includes(payload.category)) {
      return null;
    }
    reasons.push('category_in_whitelist');
  }

  // ---- Geo distance -------------------------------------------------------
  let distanceKm: number | null = null;
  let distanceChecked = false;
  if (
    typeof intent.max_distance_km === 'number' &&
    intent.origin &&
    typeof intent.origin.lat === 'number' &&
    typeof intent.origin.lng === 'number' &&
    payload.location &&
    typeof payload.location.lat === 'number' &&
    typeof payload.location.lng === 'number'
  ) {
    distanceKm = haversineKm(
      intent.origin.lat,
      intent.origin.lng,
      payload.location.lat,
      payload.location.lng
    );
    if (distanceKm > intent.max_distance_km) return null;
    distanceChecked = true;
    reasons.push('within_max_distance_km');
  }

  // ---- Time window --------------------------------------------------------
  if (intent.time_window?.start && intent.time_window.end) {
    const tz = intent.time_window.tz ?? 'UTC';
    const eventStart = payload.start_time ? new Date(payload.start_time) : new Date(nowMs);
    if (Number.isNaN(eventStart.getTime())) return null;
    const minutesOfDay = minutesOfDayInZone(eventStart, tz);
    const windowStart = parseHhmm(intent.time_window.start);
    const windowEnd = parseHhmm(intent.time_window.end);
    if (windowStart === null || windowEnd === null) return null;
    if (!minutesInWindow(minutesOfDay, windowStart, windowEnd)) return null;
    reasons.push('within_time_window');
  }

  // ---- Pay floor ----------------------------------------------------------
  if (typeof intent.min_pay_minor === 'number') {
    if (typeof payload.pay_minor !== 'number' || payload.pay_minor < intent.min_pay_minor) {
      return null;
    }
    reasons.push('min_pay_minor_met');
  }

  // All checks passed (or were not asked for). Build the match record.
  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'klokd_shift_search',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      ...(distanceChecked && distanceKm !== null
        ? { distance_km: Math.round(distanceKm * 100) / 100 }
        : {}),
      ...(payload.shift_id ? { shift_id: payload.shift_id } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing.
// ---------------------------------------------------------------------------

/**
 * Haversine great-circle distance in kilometres between two WGS-84 points.
 * Mean Earth radius 6371 km — accurate to within ~0.5 % for any pair.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Parse `"HH:MM"` to minutes-of-day. Returns null on malformed input. */
export function parseHhmm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True iff `minute` is within the inclusive [`start`, `end`] window. When
 * `start > end` the window is treated as crossing midnight (e.g. start=22:00
 * end=02:00 admits 23:30 and 01:15 but not 12:00).
 */
export function minutesInWindow(minute: number, start: number, end: number): boolean {
  if (start <= end) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
}

/**
 * Return the wall-clock minute-of-day for `instant` in the given IANA tz.
 * Uses Intl.DateTimeFormat — no dependency on a tz database; node ≥ 18
 * ships full ICU.
 */
export function minutesOfDayInZone(instant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl emits "24" for midnight in some locales — normalise.
  return ((hour % 24) * 60 + minute) % (24 * 60);
}
