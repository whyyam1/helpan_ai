/**
 * HTTP-based target-rail dispatcher (H-4).
 *
 * Forwards a dispatch payload to the target rail's HTTP endpoint, signing
 * the request with Helpan AI's tenant HMAC secret at that rail and
 * attaching the §A.2 / §A.11 cross-rail headers:
 *   - Authorization: <Rail>-HMAC-SHA256 app_id=helpan_ai, signature=…
 *   - X-Delegated-Authority: <JWT>
 *   - Traceparent: <W3C trace-context>
 *   - X-Idempotency-Key: <same key the caller used at Helpan>
 *   - X-Business-Op-Id: <§A.11 forensic-join key>
 *
 * Empty `targetUrl` is invalid — use `createUnconfiguredDispatcher()` from
 * `./dispatcher.ts` instead. The factory in this file expects a real URL.
 */

import {
  buildCanonicalString,
  sha256Hex,
  signRequest,
} from '@kmv/platform-shared/hmac';
import type {
  DispatchInput,
  DispatchOutcome,
  DispatcherTargetRail,
  TargetRailDispatcher,
} from './dispatcher.js';

/**
 * HMAC rail prefix per target — matches each rail's `Authorization` scheme
 * (e.g. KP accepts `Kipkiren-HMAC-SHA256 app_id=…`). Mirrors the issuance
 * leg in `src/lib/identitiSigner.ts` which uses `Identiti-HMAC-SHA256`.
 */
const RAIL_PREFIX: Record<DispatcherTargetRail, string> = {
  kipkiren_pay: 'Kipkiren',
  todoku: 'Todoku',
  identiti: 'Identiti',
};

export interface HttpDispatcherConfig {
  readonly rail: DispatcherTargetRail;
  /** Base URL of the target rail (e.g. `https://api.kipkiren.co.ke`). */
  readonly baseUrl: string;
  /** Path on the target rail receiving forwarded dispatches. */
  readonly dispatchPath: string;
  /** Helpan AI's app_id at the target rail's `app_credentials`. */
  readonly appId: string;
  /** Helpan AI's HMAC secret at the target rail. */
  readonly hmacSecret: string;
  /** Timestamp header name the target rail's HMAC verifier expects. */
  readonly timestampHeader: string;
  /** Injectable HTTP client — defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per-request timeout (ms). Default 15000. */
  readonly timeoutMs?: number;
}

export function createHttpDispatcher(
  config: HttpDispatcherConfig
): TargetRailDispatcher {
  const fetchImpl = config.fetch ?? fetch;
  const fullUrl = new URL(config.dispatchPath, config.baseUrl);
  const pathAndQuery = `${fullUrl.pathname}${fullUrl.search}`;
  const railPrefix = RAIL_PREFIX[config.rail];
  const timeoutMs = config.timeoutMs ?? 15000;

  return {
    rail: config.rail,
    async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
      // Helpan-AI-side envelope: target rail receives operation + opaque
      // payload + the cross-rail audit fields they MUST persist (§A.11).
      const body = JSON.stringify({
        operation: input.targetOperation,
        account_uuid: input.accountUuid,
        payload: input.payload,
        business_op_id: input.businessOpId,
      });
      const contentType = 'application/json';
      const timestamp = new Date().toISOString();
      const canonical = buildCanonicalString({
        method: 'POST',
        pathAndQuery,
        contentType,
        timestamp,
        bodySha256Hex: sha256Hex(body),
      });
      const signature = signRequest(canonical, config.hmacSecret);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = performance.now();
      let res: Response;
      try {
        res = await fetchImpl(fullUrl.toString(), {
          method: 'POST',
          headers: {
            'content-type': contentType,
            authorization: `${railPrefix}-HMAC-SHA256 app_id=${config.appId}, signature=${signature}`,
            [config.timestampHeader]: timestamp,
            'x-delegated-authority': input.delegatedAuthorityJwt,
            traceparent: input.traceparent,
            'x-idempotency-key': input.idempotencyKey,
            'x-business-op-id': input.businessOpId,
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isAbort = (err as Error).name === 'AbortError';
        return {
          status: 'failed',
          errorCode: isAbort ? 'TARGET_RAIL_TIMEOUT' : 'TARGET_RAIL_UNREACHABLE',
          detail: { rail: config.rail, message: (err as Error).message },
          latencyMs: Math.round(performance.now() - t0),
        };
      }
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - t0);

      // 2xx → completed; anything else → failed with the rail's error_code
      // surfaced if present, else a generic HTTP-status-derived code.
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        parsed = undefined;
      }

      if (res.ok) {
        return {
          status: 'completed',
          resultRedacted: extractData(parsed),
          latencyMs,
        };
      }
      const detail = extractDetail(parsed);
      return {
        status: 'failed',
        errorCode: extractErrorCode(parsed) ?? `TARGET_RAIL_HTTP_${res.status}`,
        ...(detail !== undefined ? { detail } : {}),
        latencyMs,
      };
    },
  };
}

/** Pull `data` out of a SuccessEnvelope; fall back to top-level object. */
function extractData(parsed: unknown): Record<string, unknown> {
  if (parsed && typeof parsed === 'object') {
    const env = parsed as Record<string, unknown>;
    if (env['data'] && typeof env['data'] === 'object') {
      return env['data'] as Record<string, unknown>;
    }
    return env;
  }
  return {};
}

function extractErrorCode(parsed: unknown): string | null {
  if (parsed && typeof parsed === 'object') {
    const env = parsed as Record<string, unknown>;
    const err = env['error'];
    if (err && typeof err === 'object') {
      const code = (err as Record<string, unknown>)['code'];
      if (typeof code === 'string') return code;
    }
  }
  return null;
}

function extractDetail(parsed: unknown): Record<string, unknown> | undefined {
  if (parsed && typeof parsed === 'object') {
    const env = parsed as Record<string, unknown>;
    const err = env['error'];
    if (err && typeof err === 'object') {
      const detail = (err as Record<string, unknown>)['detail'];
      if (detail && typeof detail === 'object') {
        return detail as Record<string, unknown>;
      }
    }
  }
  return undefined;
}
