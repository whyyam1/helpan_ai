/**
 * Matching engine — generic key-equality matcher.
 *
 * H-5 ships the minimum viable matcher per plan decision 2b: a briefing's
 * `intent.match` object must be a subset of the event's `payload` (i.e.
 * every key/value pair in `intent.match` exists with the same value in
 * `payload`). Type-specific matchers (`alert` / `standing_basket` /
 * `scheduled_action` / `threshold_watch`) land in per-app sprints H-9..H-12
 * as each app's intent shape gets exercised.
 *
 * Confidence: exact-equality matches are always `high`. Fuzzy / scored
 * matching is out of scope at H-5 — there is no fuzzy code path yet.
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
 * Run all pre-filtered briefings against one event.
 *
 * A briefing whose `intent.match` is missing or not an object is treated
 * as **non-matching** in H-5 — pre-H-9 briefings without a match predicate
 * never fire. Per-app sprints will introduce type-specific matchers that
 * read other intent fields (e.g. `intent.threshold`, `intent.window`).
 */
export function matchEventAgainstBriefings(
  event: MatchableEvent,
  briefings: readonly MatchableBriefing[]
): readonly BriefingMatch[] {
  const matches: BriefingMatch[] = [];
  for (const briefing of briefings) {
    const rawPredicate = briefing.intent['match'];
    if (typeof rawPredicate !== 'object' || rawPredicate === null || Array.isArray(rawPredicate)) {
      continue;
    }
    const predicate = rawPredicate as Record<string, unknown>;
    if (!payloadCoversMatchPredicate(event.payload, predicate)) continue;

    matches.push({
      briefingId: briefing.id,
      accountUuid: briefing.accountUuid,
      confidence: 'high',
      detail: {
        match_kind: 'generic_key_equality',
        predicate_keys: Object.keys(predicate),
        briefing_type: briefing.briefingType,
        event_type: event.eventType,
      },
    });
  }
  return matches;
}
