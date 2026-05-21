/**
 * Unit tests for the dispatcher abstraction (H-4).
 * Covers the unconfigured sentinel + in-memory dispatcher behaviour.
 */

import { describe, expect, it } from 'vitest';
import {
  createUnconfiguredDispatcher,
  type DispatchInput,
} from './dispatcher.js';
import { createInMemoryDispatcher } from './inMemoryDispatcher.js';

const makeInput = (overrides: Partial<DispatchInput> = {}): DispatchInput => ({
  targetRail: 'kipkiren_pay',
  targetOperation: 'payment.execute',
  payload: { amount_minor: 1000 },
  delegatedAuthorityJwt: 'header.body.sig',
  businessOpId: 'boi_test',
  traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
  idempotencyKey: 'idk_test',
  accountUuid: 'acc_00000000-0000-0000-0000-000000000001',
  ...overrides,
});

describe('createUnconfiguredDispatcher', () => {
  it('returns TARGET_RAIL_UNCONFIGURED without making any call', async () => {
    const d = createUnconfiguredDispatcher('todoku');
    const out = await d.dispatch(makeInput({ targetRail: 'todoku' }));
    expect(out.status).toBe('failed');
    if (out.status === 'failed') {
      expect(out.errorCode).toBe('TARGET_RAIL_UNCONFIGURED');
      expect(out.detail?.['rail']).toBe('todoku');
      expect(out.latencyMs).toBe(0);
    }
  });
});

describe('createInMemoryDispatcher', () => {
  it('captures every dispatch call', async () => {
    const d = createInMemoryDispatcher({ rail: 'kipkiren_pay' });
    await d.dispatch(makeInput({ targetOperation: 'payment.execute' }));
    await d.dispatch(makeInput({ targetOperation: 'payout.initiate' }));
    expect(d.calls.length).toBe(2);
    expect(d.calls[0]!.targetOperation).toBe('payment.execute');
    expect(d.calls[1]!.targetOperation).toBe('payout.initiate');
  });

  it('returns completed by default', async () => {
    const d = createInMemoryDispatcher({ rail: 'kipkiren_pay' });
    const out = await d.dispatch(makeInput());
    expect(out.status).toBe('completed');
  });

  it('forceFail returns TARGET_RAIL_REJECTED for every call', async () => {
    const d = createInMemoryDispatcher({ rail: 'kipkiren_pay', forceFail: true });
    const out = await d.dispatch(makeInput());
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.errorCode).toBe('TARGET_RAIL_REJECTED');
  });

  it('outcomes map overrides per target_operation', async () => {
    const d = createInMemoryDispatcher({
      rail: 'kipkiren_pay',
      outcomes: {
        'payment.execute': {
          status: 'failed',
          errorCode: 'KP_INSUFFICIENT_FUNDS',
          detail: { available_minor: 100 },
          latencyMs: 12,
        },
      },
    });
    const failed = await d.dispatch(makeInput({ targetOperation: 'payment.execute' }));
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.errorCode).toBe('KP_INSUFFICIENT_FUNDS');
    }
    const ok = await d.dispatch(makeInput({ targetOperation: 'payout.initiate' }));
    expect(ok.status).toBe('completed');
  });

  it('reset() clears the captured call log', async () => {
    const d = createInMemoryDispatcher({ rail: 'kipkiren_pay' });
    await d.dispatch(makeInput());
    expect(d.calls.length).toBe(1);
    d.reset();
    expect(d.calls.length).toBe(0);
  });
});
