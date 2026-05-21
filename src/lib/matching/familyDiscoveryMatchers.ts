/**
 * Family-discovery type-aware matchers (H-12). Two matchers in one
 * module — the v1.0 spec §4.3 ships two briefing shapes side-by-side.
 *
 * Time-window logic is shared with `klokdShiftMatcher`. To avoid a
 * cyclical import we re-import the helpers directly (they are pure).
 */

import type {
  BriefingMatch,
  MatchableBriefing,
  MatchableEvent,
} from './engine.js';
import {
  haversineKm,
  minutesInWindow,
  minutesOfDayInZone,
  parseHhmm,
} from './klokdShiftMatcher.js';

const FRESH_ARRIVALS_DOMAIN = 'family_discovery.fresh_arrivals';
const BASKET_REFILL_DOMAIN = 'family_discovery.basket_auto_refill';

// ---------------------------------------------------------------------------
// family_discovery.fresh_arrivals  (alert)
// ---------------------------------------------------------------------------

interface FreshArrivalsIntent {
  readonly domain?: string;
  readonly categories?: readonly string[];
  readonly max_distance_km?: number;
  readonly time_window?: {
    readonly start?: string;
    readonly end?: string;
    readonly tz?: string;
  };
  readonly max_price_minor?: number;
  readonly origin?: { readonly lat?: number; readonly lng?: number };
}

interface FreshArrivalsPayload {
  readonly listing_id?: string;
  readonly category?: string;
  readonly location?: { readonly lat?: number; readonly lng?: number };
  readonly arrived_at?: string;
  readonly price_minor?: number;
}

export function isFreshArrivalsBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as FreshArrivalsIntent)['domain'] === FRESH_ARRIVALS_DOMAIN;
}

export function matchFreshArrivalsBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent,
  nowMs: number = Date.now()
): BriefingMatch | null {
  const intent = briefing.intent as FreshArrivalsIntent;
  const payload = event.payload as FreshArrivalsPayload;
  const reasons: string[] = [];

  // ---- Category whitelist ------------------------------------------------
  if (Array.isArray(intent.categories) && intent.categories.length > 0) {
    if (!payload.category || !intent.categories.includes(payload.category)) {
      return null;
    }
    reasons.push('category_in_whitelist');
  }

  // ---- Geo distance ------------------------------------------------------
  let distanceKm: number | null = null;
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
    reasons.push('within_max_distance_km');
  }

  // ---- Time window -------------------------------------------------------
  if (intent.time_window?.start && intent.time_window.end) {
    const tz = intent.time_window.tz ?? 'UTC';
    const eventStart = payload.arrived_at
      ? new Date(payload.arrived_at)
      : new Date(nowMs);
    if (Number.isNaN(eventStart.getTime())) return null;
    const minutesOfDay = minutesOfDayInZone(eventStart, tz);
    const start = parseHhmm(intent.time_window.start);
    const end = parseHhmm(intent.time_window.end);
    if (start === null || end === null) return null;
    if (!minutesInWindow(minutesOfDay, start, end)) return null;
    reasons.push('within_time_window');
  }

  // ---- Max price ----------------------------------------------------------
  if (typeof intent.max_price_minor === 'number') {
    if (typeof payload.price_minor !== 'number' || payload.price_minor > intent.max_price_minor) {
      return null;
    }
    reasons.push('within_max_price_minor');
  }

  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'family_discovery_fresh_arrivals',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      ...(distanceKm !== null ? { distance_km: Math.round(distanceKm * 100) / 100 } : {}),
      ...(payload.listing_id ? { listing_id: payload.listing_id } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// family_discovery.basket_auto_refill  (standing_basket)
// ---------------------------------------------------------------------------
//
// Standing-basket cron-firing is gated on KP C.3 programmable money
// (§4.7 — required, no v1.0 workaround). The matcher is wired so that
// when a synthetic "basket tick" event arrives (either app-side cron in
// the interim or KP programmable-money at v1.1), the basket can be
// validated against the briefing constraints in one place.

interface BasketRefillIntent {
  readonly domain?: string;
  readonly schedule?: string; // metadata; not evaluated by the matcher
  readonly merchant_ids?: readonly string[];
  readonly items?: ReadonlyArray<{
    readonly sku?: string;
    readonly max_price_minor?: number;
  }>;
  readonly max_total_minor?: number;
}

interface BasketTickLineItem {
  readonly sku?: string;
  readonly price_minor?: number;
  readonly qty?: number;
}

interface BasketTickPayload {
  readonly basket_id?: string;
  readonly merchant_id?: string;
  readonly line_items?: readonly BasketTickLineItem[];
  readonly total_minor?: number;
}

export function isBasketRefillBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as BasketRefillIntent)['domain'] === BASKET_REFILL_DOMAIN;
}

/**
 * Match a basket-tick event against a standing_basket briefing. ALL
 * line items in the event MUST satisfy the briefing's per-SKU ceiling;
 * any unrecognised SKU rejects the whole tick (safety policy decision —
 * a basket that adds an off-list item shouldn't fire).
 */
export function matchBasketRefillBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent
): BriefingMatch | null {
  const intent = briefing.intent as BasketRefillIntent;
  const payload = event.payload as BasketTickPayload;
  const reasons: string[] = [];

  // ---- Merchant ----------------------------------------------------------
  if (Array.isArray(intent.merchant_ids) && intent.merchant_ids.length > 0) {
    if (!payload.merchant_id || !intent.merchant_ids.includes(payload.merchant_id)) {
      return null;
    }
    reasons.push('merchant_in_allowlist');
  }

  // ---- Per-line SKU + price ceiling -------------------------------------
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  if (lineItems.length === 0) return null;

  if (Array.isArray(intent.items) && intent.items.length > 0) {
    const byKey: Record<string, number | undefined> = {};
    for (const i of intent.items) {
      if (i.sku) byKey[i.sku] = i.max_price_minor;
    }
    let approvedLines = 0;
    for (const line of lineItems) {
      if (!line.sku || !(line.sku in byKey)) return null; // unrecognised SKU
      const ceiling = byKey[line.sku];
      if (typeof ceiling === 'number') {
        if (typeof line.price_minor !== 'number' || line.price_minor > ceiling) return null;
      }
      approvedLines++;
    }
    reasons.push(`all_${approvedLines}_lines_approved`);
  }

  // ---- Basket total ceiling ---------------------------------------------
  if (typeof intent.max_total_minor === 'number') {
    if (
      typeof payload.total_minor !== 'number' ||
      payload.total_minor > intent.max_total_minor
    ) {
      return null;
    }
    reasons.push('within_max_total_minor');
  }

  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'family_discovery_basket_auto_refill',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      ...(payload.basket_id ? { basket_id: payload.basket_id } : {}),
      ...(payload.merchant_id ? { merchant_id: payload.merchant_id } : {}),
      ...(typeof payload.total_minor === 'number'
        ? { total_minor: payload.total_minor }
        : {}),
    },
  };
}
