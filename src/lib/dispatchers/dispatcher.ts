/**
 * Target-rail dispatcher abstraction (H-4).
 *
 * Helpan AI never executes an action itself (Cardinal Rule §3.1). Every
 * dispatch is a forwarded call to the relying rail's own endpoint, with
 *   - HMAC tenant credentials (Helpan AI is registered as a tenant at each
 *     target rail; see RECAP §1 for HELPAN_*_AT_KP / TODOKU env vars).
 *   - The delegated-authority JWT as `X-Delegated-Authority` so the relying
 *     rail can perform its own per-call validation per Reboot Pack §A.2.
 *   - `Traceparent` and the §A.11 `business_op_id` so the relying rail can
 *     write audit entries that join cleanly with the Helpan AI audit chain.
 *
 * The interface is one method (`dispatch`) per target rail. Per rail we
 * ship a production HTTP implementation plus an in-process implementation
 * for tests. The dispatcher is selected per request by `target_rail`.
 *
 * **Disabled-by-empty:** if the production URL for a target rail is unset,
 * the dispatcher resolves to a sentinel that returns `failed` with
 * `TARGET_RAIL_UNCONFIGURED`. The rail keeps booting and `/v1/actions/dispatch`
 * keeps validating + persisting + auditing — only the outbound call is
 * skipped. Same disabled-by-empty pattern as H-5 webhook fan-out.
 */

export type DispatcherTargetRail = 'kipkiren_pay' | 'identiti' | 'todoku';

export interface DispatchInput {
  /** Target rail (drives selection). */
  readonly targetRail: DispatcherTargetRail;
  /** Operation identifier as defined by the target rail's API. */
  readonly targetOperation: string;
  /** Forwarded request body. Pre-redacted of Helpan-side PII. */
  readonly payload: Record<string, unknown>;
  /** Delegated authority JWT (the X-Delegated-Authority header value). */
  readonly delegatedAuthorityJwt: string;
  /** §A.11 cross-rail forensic-join key. */
  readonly businessOpId: string;
  /** W3C trace-context; propagated unchanged. */
  readonly traceparent: string;
  /** Per-request idempotency key — forwarded so the target rail can dedup. */
  readonly idempotencyKey: string;
  /** Account UUID — many target rails require it on the wire too. */
  readonly accountUuid: string;
}

export type DispatchOutcome =
  | {
      readonly status: 'completed';
      /** Redacted response body the target rail returned. */
      readonly resultRedacted: Record<string, unknown>;
      /** Latency from request start to response. */
      readonly latencyMs: number;
    }
  | {
      readonly status: 'failed';
      /** Stable error code surfaced in `actions.error_code` + on the wire. */
      readonly errorCode: string;
      /** Optional structured details (already redacted). */
      readonly detail?: Record<string, unknown>;
      readonly latencyMs: number;
    };

export interface TargetRailDispatcher {
  readonly rail: DispatcherTargetRail;
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

/**
 * Map of target-rail → dispatcher. The actions service selects by
 * `input.targetRail`; unknown rails get the `unconfigured` sentinel which
 * fails synchronously without an outbound call.
 */
export type DispatcherRegistry = Readonly<
  Record<DispatcherTargetRail, TargetRailDispatcher>
>;

/**
 * Sentinel "disabled" dispatcher. Used when a target-rail URL is unset.
 * Persists the action as failed without ever opening a socket.
 */
export function createUnconfiguredDispatcher(
  rail: DispatcherTargetRail
): TargetRailDispatcher {
  return {
    rail,
    async dispatch() {
      return {
        status: 'failed',
        errorCode: 'TARGET_RAIL_UNCONFIGURED',
        detail: {
          rail,
          reason:
            'No dispatch URL configured for this target rail in the rail env (HELPAN_*_URL). ' +
            'Set the env var and redeploy to enable live dispatch.',
        },
        latencyMs: 0,
      };
    },
  };
}
