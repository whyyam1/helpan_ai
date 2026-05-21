/**
 * In-memory dispatcher for tests. Captures every dispatch call into a
 * mutable log so assertions can inspect what was sent. The verdict per
 * call is programmable — defaults to `completed`, callers can preload
 * `failures` keyed by target operation to force a `failed` outcome.
 */

import type {
  DispatchInput,
  DispatchOutcome,
  DispatcherTargetRail,
  TargetRailDispatcher,
} from './dispatcher.js';

export interface InMemoryDispatcherOptions {
  readonly rail: DispatcherTargetRail;
  /** Map of `targetOperation → outcome` overrides. */
  readonly outcomes?: Readonly<Record<string, DispatchOutcome>>;
  /** If true, every call fails with `TARGET_RAIL_REJECTED`. */
  readonly forceFail?: boolean;
}

export interface InMemoryDispatcher extends TargetRailDispatcher {
  readonly calls: ReadonlyArray<DispatchInput>;
  reset(): void;
}

export function createInMemoryDispatcher(
  options: InMemoryDispatcherOptions
): InMemoryDispatcher {
  const calls: DispatchInput[] = [];
  return {
    rail: options.rail,
    get calls() {
      return calls;
    },
    reset() {
      calls.length = 0;
    },
    async dispatch(input: DispatchInput) {
      calls.push(input);
      if (options.forceFail) {
        return {
          status: 'failed',
          errorCode: 'TARGET_RAIL_REJECTED',
          detail: { reason: 'forceFail set on in-memory dispatcher' },
          latencyMs: 1,
        };
      }
      const override = options.outcomes?.[input.targetOperation];
      if (override) return override;
      return {
        status: 'completed',
        resultRedacted: { ok: true, operation: input.targetOperation },
        latencyMs: 1,
      };
    },
  };
}
