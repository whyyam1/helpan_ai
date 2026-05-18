/**
 * Delegated-authority signer — the client leg of the H4 joint contract.
 *
 * Helpan AI never holds the delegated-authority signing key. It POSTs the
 * §2.3 claim set to Identiti's `POST /v1/internal/sign` (HMAC-authed, scope
 * `identiti:internal:sign:delegated_authority`) and receives a signed JWT.
 *
 * `createHttpIdentitiSigner` is the production implementation. Tests inject
 * an in-process signer (see test/helpers) that RS256-signs locally with a
 * known keypair so issuance can be exercised without a live Identiti.
 */

import {
  buildCanonicalString,
  sha256Hex,
  signRequest,
} from '@kmv/platform-shared/hmac';
import type { DelegatedAuthorityClaims } from '../modules/authorities/claimBuilder.js';

export interface SignRequestInput {
  readonly kid: string;
  readonly claims: DelegatedAuthorityClaims;
}

export type SignResult =
  | { readonly ok: true; readonly token: string; readonly signedAt: Date }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly httpStatus: number;
    };

export interface DelegatedAuthoritySigner {
  sign(input: SignRequestInput): Promise<SignResult>;
}

export interface HttpIdentitiSignerConfig {
  /** Full URL of Identiti's `POST /v1/internal/sign`. */
  readonly signUrl: string;
  /** HMAC secret for Helpan AI's tenant at Identiti. */
  readonly hmacSecret: string;
  /** Helpan AI's app_id as registered in Identiti's app_credentials. */
  readonly appId: string;
  /** Timestamp header name Identiti's HMAC verifier expects. */
  readonly timestampHeader: string;
  /** Injectable HTTP client — defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

interface IdentitiSuccess {
  ok: true;
  data: { token: string; signed_at: string };
}
interface IdentitiError {
  ok: false;
  error: { code: string; message: string };
}

export function createHttpIdentitiSigner(
  config: HttpIdentitiSignerConfig
): DelegatedAuthoritySigner {
  const fetchImpl = config.fetch ?? fetch;
  const url = new URL(config.signUrl);
  const pathAndQuery = `${url.pathname}${url.search}`;

  return {
    async sign(input) {
      const body = JSON.stringify({ kid: input.kid, claims: input.claims });
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

      let res: Response;
      try {
        res = await fetchImpl(config.signUrl, {
          method: 'POST',
          headers: {
            'content-type': contentType,
            authorization: `Identiti-HMAC-SHA256 app_id=${config.appId}, signature=${signature}`,
            [config.timestampHeader]: timestamp,
          },
          body,
        });
      } catch (err) {
        return {
          ok: false,
          code: 'IDENTITI_SIGN_UNREACHABLE',
          message: `Identiti signing endpoint unreachable: ${(err as Error).message}`,
          httpStatus: 502,
        };
      }

      let parsed: IdentitiSuccess | IdentitiError;
      try {
        parsed = (await res.json()) as IdentitiSuccess | IdentitiError;
      } catch {
        return {
          ok: false,
          code: 'IDENTITI_SIGN_BAD_RESPONSE',
          message: `Identiti returned a non-JSON response (HTTP ${res.status})`,
          httpStatus: 502,
        };
      }

      if (res.ok && parsed.ok) {
        return {
          ok: true,
          token: parsed.data.token,
          signedAt: new Date(parsed.data.signed_at),
        };
      }
      if (!parsed.ok) {
        return {
          ok: false,
          code: parsed.error.code,
          message: parsed.error.message,
          httpStatus: res.status,
        };
      }
      return {
        ok: false,
        code: 'IDENTITI_SIGN_BAD_RESPONSE',
        message: `Identiti returned HTTP ${res.status} with an unexpected body`,
        httpStatus: 502,
      };
    },
  };
}
