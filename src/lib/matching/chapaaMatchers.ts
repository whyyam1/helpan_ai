/**
 * Chapaa type-aware matchers (H-11). Two related matchers — round-up
 * and goal-acceleration — live in one module because both are small and
 * share a domain prefix.
 *
 * Highest-stakes integration in the portfolio per per-app patterns §3.1;
 * autonomous money movement is narrow at v1.0 (only round-up).
 */

import type {
  BriefingMatch,
  MatchableBriefing,
  MatchableEvent,
} from './engine.js';

const ROUND_UP_DOMAIN = 'chapaa.round_up_offer';
const GOAL_ACCEL_DOMAIN = 'chapaa.goal_acceleration';

/**
 * Default round-up unit (minor units). 10 000 minor = KES 100 — round to
 * the nearest hundred shillings, the most natural "round-up savings"
 * behaviour. Overridable per briefing via `intent.round_unit_minor`.
 */
const DEFAULT_ROUND_UNIT_MINOR = 10_000;

// ---------------------------------------------------------------------------
// chapaa.round_up_offer
// ---------------------------------------------------------------------------

interface RoundUpIntent {
  readonly domain?: string;
  readonly min_unrounded_minor?: number;
  readonly max_round_up_minor?: number;
  readonly round_unit_minor?: number;
}

interface WalletDebitedPayload {
  readonly amount_minor?: number;
  readonly transaction_id?: string;
}

export function isRoundUpBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as RoundUpIntent)['domain'] === ROUND_UP_DOMAIN;
}

/**
 * Match against a KP `WALLET_DEBITED` event. Pure math:
 *
 *   unrounded_minor = amount_minor mod ROUND_UNIT
 *   round_up_minor  = ROUND_UNIT - unrounded_minor   (when unrounded > 0)
 *                   = 0                              (when amount is an exact
 *                                                     multiple of ROUND_UNIT)
 *
 * Match conditions (all AND'd):
 *   - amount_minor must be a positive number
 *   - round_up_minor > 0 (no point depositing zero)
 *   - unrounded_minor ≥ briefing.min_unrounded_minor   (if set)
 *   - round_up_minor ≤ briefing.max_round_up_minor    (if set)
 *
 * Match `detail.computed_round_up_minor` is the deposit amount the
 * downstream `POST /actions/dispatch` should carry.
 */
export function matchRoundUpBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent
): BriefingMatch | null {
  const intent = briefing.intent as RoundUpIntent;
  const payload = event.payload as WalletDebitedPayload;
  const reasons: string[] = [];

  if (typeof payload.amount_minor !== 'number' || payload.amount_minor <= 0) return null;

  const unit = typeof intent.round_unit_minor === 'number' && intent.round_unit_minor > 0
    ? intent.round_unit_minor
    : DEFAULT_ROUND_UNIT_MINOR;

  const unrounded = payload.amount_minor % unit;
  if (unrounded === 0) return null; // already round — no round-up
  const roundUp = unit - unrounded;
  reasons.push('round_up_positive');

  if (typeof intent.min_unrounded_minor === 'number') {
    if (unrounded < intent.min_unrounded_minor) return null;
    reasons.push('min_unrounded_minor_met');
  }
  if (typeof intent.max_round_up_minor === 'number') {
    if (roundUp > intent.max_round_up_minor) return null;
    reasons.push('within_max_round_up_minor');
  }

  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'chapaa_round_up_offer',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      computed_round_up_minor: roundUp,
      computed_unrounded_minor: unrounded,
      round_unit_minor: unit,
      ...(payload.transaction_id ? { transaction_id: payload.transaction_id } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// chapaa.goal_acceleration
// ---------------------------------------------------------------------------

interface GoalAccelIntent {
  readonly domain?: string;
  readonly goal_id?: string;
  readonly alert_when?: string;
  readonly suggest_amount_minor?: number;
}

interface GoalPaceEventPayload {
  readonly goal_id?: string;
  readonly signal?: string;
  readonly current_pace_minor?: number;
  readonly target_pace_minor?: number;
}

export function isGoalAccelerationBriefing(briefing: MatchableBriefing): boolean {
  return (briefing.intent as GoalAccelIntent)['domain'] === GOAL_ACCEL_DOMAIN;
}

/**
 * Match against a Chapaa-emitted goal-pace event. Two checks:
 *   - briefing.goal_id MUST equal payload.goal_id
 *   - briefing.alert_when MUST equal payload.signal
 *
 * Both are simple identity checks; the inbound publisher (Chapaa backend)
 * is responsible for computing whether the current pace is below target
 * and emitting the corresponding `signal` string.
 */
export function matchGoalAccelerationBriefing(
  briefing: MatchableBriefing,
  event: MatchableEvent
): BriefingMatch | null {
  const intent = briefing.intent as GoalAccelIntent;
  const payload = event.payload as GoalPaceEventPayload;
  const reasons: string[] = [];

  if (!intent.goal_id || intent.goal_id !== payload.goal_id) return null;
  reasons.push('goal_id_match');

  if (intent.alert_when) {
    if (payload.signal !== intent.alert_when) return null;
    reasons.push('signal_match');
  }

  return {
    briefingId: briefing.id,
    accountUuid: briefing.accountUuid,
    confidence: 'high',
    detail: {
      match_kind: 'chapaa_goal_acceleration',
      briefing_type: briefing.briefingType,
      event_type: event.eventType,
      reasons,
      goal_id: intent.goal_id,
      ...(intent.suggest_amount_minor !== undefined
        ? { suggest_amount_minor: intent.suggest_amount_minor }
        : {}),
      ...(payload.current_pace_minor !== undefined
        ? { current_pace_minor: payload.current_pace_minor }
        : {}),
      ...(payload.target_pace_minor !== undefined
        ? { target_pace_minor: payload.target_pace_minor }
        : {}),
    },
  };
}
