/**
 * Matching engine.
 *
 * H-5 shipped the generic key-equality matcher (subset of intent.match in
 * payload). H-9 makes this a **strategy router** — briefings with
 * `intent.domain` set go to a type-aware matcher (`klokd.shift_search` →
 * `klokdShiftMatcher`); anything else falls back to the H-5 generic matcher.
 * Per-app sprints H-10..H-12 add their own matchers under the same router.
 *
 * Pre-filtering (eligibility before this function is called):
 *   - briefing.status = 'active'
 *   - briefing.app_id = event.app_id
 *   - briefing.account_uuid = event.account_uuid (when event is account-scoped)
 *   - briefing.expires_at IS NULL OR > now()
 *
 * Those filters live in the repo so the SQL planner can use the
 * `(account_uuid, status)` and `(app_id, status)` indexes; this engine
 * trusts its inputs and only evaluates the intent payload.
 *
 * Confidence: every v1.0 matcher (generic + Klokd) returns `high` on match —
 * either the predicate is satisfied or it isn't. Fuzzy / scored matching
 * is a v1.1+ item.
 */

export interface MatchableBriefing {
  readonly id: string;
  readonly accountUuid: string;
  readonly appId: string;
  readonly briefingType: string;
  readonly intent: Record<string, unknown>;
}

export interface MatchableEvent {
  readonly id: string;
  readonly eventType: string;
  readonly appId: string;
  readonly accountUuid: string | null;
  readonly payload: Record<string, unknown>;
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface BriefingMatch {
  readonly briefingId: string;
  readonly accountUuid: string;
  readonly confidence: MatchConfidence;
  /** Diagnostic detail kept on the briefing_matches row + webhook payload. */
  readonly detail: Record<string, unknown>;
}

/**
 * Deep equality for JSON-safe values. JSON has no NaN / -0 / undefined
 * concerns so reference-vs-value distinctions don't matter; this is just
 * a structural compare.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    if (aKeys.length !== Object.keys(bo).length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
      if (!jsonEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * True iff every key in `match` is present in `payload` with an equal value.
 * Extra keys in `payload` are ignored — the briefing only specifies what it
 * cares about.
 */
function payloadCoversMatchPredicate(
  payload: Record<string, unknown>,
  matchPredicate: Record<string, unknown>
): boolean {
  for (const [key, expected] of Object.entries(matchPredicate)) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return false;
    if (!jsonEqual(payload[key], expected)) return false;
  }
  return true;
}

/**
 * Strategy router. Reads `briefing.intent.domain` and dispatches to the
 * matching per-app matcher. Imported lazily-via-static-import below; if
 * `domain` is unset or unknown, falls back to the H-5 generic key-equality
 * matcher.
 *
 * Per-app sprints register their matcher here; the table stays small so a
 * lookup is constant-time and the dependency graph is explicit (no
 * dynamic-require). Adding a new matcher is one line.
 */
function genericMatch(
  briefing: MatchableBriefing,
  event: MatchableEvent
): BriefingMatch | null {
  const rawPredicate = briefing.intent['match'];
  if (typeof rawPredicate !== 'object' || rawPredicate === null || Array.isArray(rawPredicate)) {
    return null;
  }
  const predicate = rawPredicate as Record<string, unknown>;
  if (!payloadCoversMatchPredicate(event.payload, predicate)) return null;
  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'generic_key_equality',
      predicate_keys: Object.keys(predicate),
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
    },
  };
}

/**
 * Run all pre-filtered briefings against one event. Dispatches per-briefing
 * to the matcher selected by `intent.domain`.
 *
 * A briefing whose intent neither names a registered domain nor carries a
 * generic `match` predicate is treated as **non-matching** — pre-H-9
 * briefings without a match predicate never fired and the same is true
 * here.
 */
export function matchEventAgainstBriefings(
  event: MatchableEvent,
  briefings: readonly MatchableBriefing[]
): readonly BriefingMatch[] {
  // Import lazily inside the function body to avoid an at-load cycle if a
  // future per-app matcher imports from this module. The Klokd matcher
  // currently does — it consumes the public types defined above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- pure static import below
  const matches: BriefingMatch[] = [];
  for (const briefing of briefings) {
    const domain = briefing.intent['domain'];
    const matcher = typeof domain === 'string' ? DOMAIN_MATCHERS[domain] : undefined;
    const match = matcher ? matcher(briefing, event) : genericMatch(briefing, event);
    if (match) matches.push(match);
  }
  return matches;
}

// Registered per-app matchers. Add new domains here as each per-app sprint
// (H-12 family-discovery) lands.
import { isKlokdShiftBriefing, matchKlokdShiftBriefing } from './klokdShiftMatcher.js';
import {
  isLunchDropPlanBriefing,
  matchLunchDropPlanBriefing,
} from './lunchDropPlanMatcher.js';
import {
  isGoalAccelerationBriefing,
  isRoundUpBriefing,
  matchGoalAccelerationBriefing,
  matchRoundUpBriefing,
} from './chapaaMatchers.js';

type DomainMatcher = (
  b: MatchableBriefing,
  e: MatchableEvent
) => BriefingMatch | null;

const DOMAIN_MATCHERS: Readonly<Record<string, DomainMatcher>> = {
  'klokd.shift_search': (b, e) => {
    // Defensive: route guard repeats the discriminator check so a malformed
    // briefing (domain set but other intent fields missing) returns null
    // rather than throwing.
    if (!isKlokdShiftBriefing(b)) return null;
    return matchKlokdShiftBriefing(b, e);
  },
  'lunchdrop.weekly_plan': (b, e) => {
    if (!isLunchDropPlanBriefing(b)) return null;
    return matchLunchDropPlanBriefing(b, e);
  },
  'chapaa.round_up_offer': (b, e) => {
    if (!isRoundUpBriefing(b)) return null;
    return matchRoundUpBriefing(b, e);
  },
  'chapaa.goal_acceleration': (b, e) => {
    if (!isGoalAccelerationBriefing(b)) return null;
    return matchGoalAccelerationBriefing(b, e);
  },
};
