/**
 * Unit tests for the Chapaa matchers (H-11): round-up + goal-acceleration.
 */

import { describe, expect, it } from 'vitest';
import {
  isGoalAccelerationBriefing,
  isRoundUpBriefing,
  matchGoalAccelerationBriefing,
  matchRoundUpBriefing,
} from './chapaaMatchers.js';
import type { MatchableBriefing, MatchableEvent } from './engine.js';

function briefing(intent: Record<string, unknown>): MatchableBriefing {
  return {
    id: 'brf_chapaa',
    accountUuid: 'acc_test',
    appId: 'chapaa',
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
    appId: 'chapaa',
    accountUuid: 'acc_test',
    payload,
  };
}

// ---- discriminators --------------------------------------------------------

describe('isRoundUpBriefing / isGoalAccelerationBriefing', () => {
  it('discriminates by intent.domain', () => {
    expect(isRoundUpBriefing(briefing({ domain: 'chapaa.round_up_offer' }))).toBe(true);
    expect(isRoundUpBriefing(briefing({ domain: 'chapaa.goal_acceleration' }))).toBe(false);
    expect(isGoalAccelerationBriefing(briefing({ domain: 'chapaa.goal_acceleration' }))).toBe(true);
    expect(isGoalAccelerationBriefing(briefing({ domain: 'klokd.shift_search' }))).toBe(false);
  });
});

// ---- round-up matcher ------------------------------------------------------

describe('matchRoundUpBriefing', () => {
  const ROUND_UP_INTENT = (extra: Record<string, unknown> = {}) =>
    briefing({
      domain: 'chapaa.round_up_offer',
      min_unrounded_minor: 50,
      max_round_up_minor: 20000,
      ...extra,
    });

  it('matches a typical wallet debit (KES 4847 → round-up KES 53)', () => {
    // KES 4847 = 484700 minor. Default unit 10000 (100 KES).
    // unrounded = 4700, round_up = 5300. unrounded>=50, round_up<=20000 → MATCH.
    const m = matchRoundUpBriefing(
      ROUND_UP_INTENT(),
      event('kp.wallet.debited', { amount_minor: 484700, transaction_id: 'tx_1' })
    );
    expect(m).not.toBeNull();
    expect(m!.detail['computed_round_up_minor']).toBe(5300);
    expect(m!.detail['computed_unrounded_minor']).toBe(4700);
    expect(m!.detail['round_unit_minor']).toBe(10000);
    expect(m!.detail['transaction_id']).toBe('tx_1');
    expect((m!.detail['reasons'] as string[])).toEqual([
      'round_up_positive',
      'min_unrounded_minor_met',
      'within_max_round_up_minor',
    ]);
  });

  it('rejects when amount is already on a round-unit boundary', () => {
    // KES 5000 = 500000 minor — exact multiple of 10000 → no round-up possible.
    expect(
      matchRoundUpBriefing(ROUND_UP_INTENT(), event('kp.wallet.debited', { amount_minor: 500000 }))
    ).toBeNull();
  });

  it('rejects when unrounded is below the briefing floor', () => {
    // unrounded = 480_030 mod 10_000 = 30 < 50 → reject (round_up = 9970)
    const b = ROUND_UP_INTENT();
    expect(
      matchRoundUpBriefing(b, event('kp.wallet.debited', { amount_minor: 480_030 }))
    ).toBeNull();
  });

  it('rejects when round-up would exceed the briefing ceiling', () => {
    // unrounded = 4700, round_up = 5300. Ceiling 5000 → reject.
    const b = briefing({
      domain: 'chapaa.round_up_offer',
      max_round_up_minor: 5000,
    });
    expect(
      matchRoundUpBriefing(b, event('kp.wallet.debited', { amount_minor: 484700 }))
    ).toBeNull();
  });

  it('respects a custom round_unit_minor override', () => {
    // unit = 100 (= KES 1). amount = KES 48.47 = 4847 minor.
    // unrounded = 47, round_up = 53.
    const b = briefing({
      domain: 'chapaa.round_up_offer',
      round_unit_minor: 100,
      min_unrounded_minor: 40,
      max_round_up_minor: 100,
    });
    const m = matchRoundUpBriefing(b, event('kp.wallet.debited', { amount_minor: 4847 }));
    expect(m).not.toBeNull();
    expect(m!.detail['computed_round_up_minor']).toBe(53);
    expect(m!.detail['round_unit_minor']).toBe(100);
  });

  it('rejects on non-positive or missing amount_minor', () => {
    expect(
      matchRoundUpBriefing(ROUND_UP_INTENT(), event('kp.wallet.debited', {}))
    ).toBeNull();
    expect(
      matchRoundUpBriefing(ROUND_UP_INTENT(), event('kp.wallet.debited', { amount_minor: 0 }))
    ).toBeNull();
    expect(
      matchRoundUpBriefing(ROUND_UP_INTENT(), event('kp.wallet.debited', { amount_minor: -100 }))
    ).toBeNull();
  });

  it('skips min_unrounded check when briefing omits the floor', () => {
    // No min_unrounded_minor — any positive unrounded matches the floor axis.
    const b = briefing({ domain: 'chapaa.round_up_offer' });
    const m = matchRoundUpBriefing(b, event('kp.wallet.debited', { amount_minor: 1 }));
    expect(m).not.toBeNull();
    expect(m!.detail['computed_round_up_minor']).toBe(9999);
  });
});

// ---- goal-acceleration matcher --------------------------------------------

describe('matchGoalAccelerationBriefing', () => {
  it('matches when goal_id and signal both align', () => {
    const b = briefing({
      domain: 'chapaa.goal_acceleration',
      goal_id: 'goal_wedding',
      alert_when: 'weekly_pace_below_target',
      suggest_amount_minor: 20000,
    });
    const e = event('chapaa.goal_pace', {
      goal_id: 'goal_wedding',
      signal: 'weekly_pace_below_target',
      current_pace_minor: 12000,
      target_pace_minor: 20000,
    });
    const m = matchGoalAccelerationBriefing(b, e);
    expect(m).not.toBeNull();
    expect(m!.detail['match_kind']).toBe('chapaa_goal_acceleration');
    expect(m!.detail['goal_id']).toBe('goal_wedding');
    expect(m!.detail['suggest_amount_minor']).toBe(20000);
    expect(m!.detail['current_pace_minor']).toBe(12000);
    expect(m!.detail['target_pace_minor']).toBe(20000);
  });

  it('rejects on goal_id mismatch', () => {
    const b = briefing({
      domain: 'chapaa.goal_acceleration',
      goal_id: 'goal_wedding',
      alert_when: 'weekly_pace_below_target',
    });
    expect(
      matchGoalAccelerationBriefing(
        b,
        event('chapaa.goal_pace', {
          goal_id: 'goal_school',
          signal: 'weekly_pace_below_target',
        })
      )
    ).toBeNull();
  });

  it('rejects on signal mismatch', () => {
    const b = briefing({
      domain: 'chapaa.goal_acceleration',
      goal_id: 'goal_wedding',
      alert_when: 'weekly_pace_below_target',
    });
    expect(
      matchGoalAccelerationBriefing(
        b,
        event('chapaa.goal_pace', {
          goal_id: 'goal_wedding',
          signal: 'goal_achieved',
        })
      )
    ).toBeNull();
  });

  it('rejects when briefing has no goal_id (would match anything otherwise)', () => {
    const b = briefing({
      domain: 'chapaa.goal_acceleration',
      alert_when: 'weekly_pace_below_target',
    });
    expect(
      matchGoalAccelerationBriefing(
        b,
        event('chapaa.goal_pace', { goal_id: 'goal_x', signal: 'weekly_pace_below_target' })
      )
    ).toBeNull();
  });

  it('skips signal check when alert_when is absent (any signal on the goal matches)', () => {
    const b = briefing({
      domain: 'chapaa.goal_acceleration',
      goal_id: 'goal_wedding',
    });
    const m = matchGoalAccelerationBriefing(
      b,
      event('chapaa.goal_pace', { goal_id: 'goal_wedding', signal: 'whatever' })
    );
    expect(m).not.toBeNull();
    expect((m!.detail['reasons'] as string[])).toEqual(['goal_id_match']);
  });
});
