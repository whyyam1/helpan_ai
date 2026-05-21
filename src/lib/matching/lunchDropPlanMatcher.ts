/**
 * Lunch Drop `lunchdrop.weekly_plan` matcher (H-10).
 *
 * Briefing intent shape (per per-app patterns §2.3):
 *
 *   {
 *     domain: "lunchdrop.weekly_plan",
 *     merchant_id: "mer_...",
 *     schedule: "0 12 * * 1-5",            // weekdays at noon (informational)
 *     menu_preference: ["chapati", "stew"],
 *     max_per_order_minor: 80000,
 *     fallback_merchant_ids: ["mer_...", "mer_..."]
 *   }
 *
 * Inbound event payload shape (Lunch Drop's offer-event):
 *
 *   {
 *     order_id: "ord_...",                    // optional — for trace detail
 *     merchant_id: "mer_...",
 *     items: [{name: "chapati", qty: 1, unit_price_minor: 25000}, ...],
 *     total_minor: 75000
 *   }
 *
 * Matcher contract (all AND'd; each condition skipped if the briefing
 * omits its controlling field):
 *
 *   - merchant_id check: event.merchant_id MUST equal briefing.merchant_id
 *     OR appear in briefing.fallback_merchant_ids. The `schedule` field is
 *     metadata (when the briefing would normally fire), not a match input;
 *     cron-driven firing is deferred to v1.1 with programmable money.
 *   - menu_preference: at least one item in event.items must match (by name
 *     case-insensitive). If briefing.menu_preference is empty/absent, the
 *     check is skipped.
 *   - max_per_order_minor: event.total_minor MUST be ≤ ceiling.
 */

import type {
  BriefingMatch,
  MatchableBriefing,
  MatchableEvent,
} from './engine.js';

const LUNCHDROP_DOMAIN = 'lunchdrop.weekly_plan';

interface LunchDropIntent {
  readonly domain?: string;
  readonly merchant_id?: string;
  readonly fallback_merchant_ids?: readonly string[];
  readonly menu_preference?: readonly string[];
  readonly max_per_order_minor?: number;
}

interface LunchDropEventItem {
  readonly name?: string;
  readonly qty?: number;
  readonly unit_price_minor?: number;
}

interface LunchDropEventPayload {
  readonly order_id?: string;
  readonly merchant_id?: string;
  readonly items?: readonly LunchDropEventItem[];
  readonly total_minor?: number;
}

export function isLunchDropPlanBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as LunchDropIntent)['domain'] === LUNCHDROP_DOMAIN;
}

export function matchLunchDropPlanBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent
): BriefingMatch | null {
  const intent = briefing.intent as LunchDropIntent;
  const payload = event.payload as LunchDropEventPayload;
  const reasons: string[] = [];

  // ---- Merchant -----------------------------------------------------------
  // The briefing constrains either by primary merchant or by a fallback set.
  // If both are absent, the check is skipped (open match on the merchant
  // axis — useful for "any merchant near me" style briefings even though
  // §2.3 doesn't show one).
  const candidates: string[] = [];
  if (intent.merchant_id) candidates.push(intent.merchant_id);
  if (Array.isArray(intent.fallback_merchant_ids)) {
    candidates.push(...intent.fallback_merchant_ids);
  }
  let matchedMerchant: 'primary' | 'fallback' | null = null;
  if (candidates.length > 0) {
    if (!payload.merchant_id || !candidates.includes(payload.merchant_id)) {
      return null;
    }
    matchedMerchant = payload.merchant_id === intent.merchant_id ? 'primary' : 'fallback';
    reasons.push(matchedMerchant === 'primary' ? 'merchant_primary' : 'merchant_fallback');
  }

  // ---- Menu preference ----------------------------------------------------
  if (Array.isArray(intent.menu_preference) && intent.menu_preference.length > 0) {
    const wanted = intent.menu_preference.map((s) => s.toLowerCase());
    const items = Array.isArray(payload.items) ? payload.items : [];
    const hit = items.some(
      (i) => typeof i.name === 'string' && wanted.includes(i.name.toLowerCase())
    );
    if (!hit) return null;
    reasons.push('menu_preference_hit');
  }

  // ---- Per-order ceiling --------------------------------------------------
  if (typeof intent.max_per_order_minor === 'number') {
    if (typeof payload.total_minor !== 'number' || payload.total_minor > intent.max_per_order_minor) {
      return null;
    }
    reasons.push('within_max_per_order_minor');
  }

  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'lunchdrop_weekly_plan',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      ...(matchedMerchant !== null ? { merchant_matched_as: matchedMerchant } : {}),
      ...(payload.order_id ? { order_id: payload.order_id } : {}),
    },
  };
}
