/**
 * Fastify plugin: verifies Identiti-issued **customer JWTs** for inbound
 * `/v1/briefings/*` requests.
 *
 * Per OpenAPI §components.securitySchemes.BearerCustomer, the briefings
 * surface accepts customer-token JWTs minted by Identiti's
 * `POST /v1/auth/customer-token`. RS256, kid in header, claims:
 *
 *     iss          (must equal config.issuer)
 *     aud          (array; must include config.audience)
 *     sub          (Account UUID — `acc_<uuid>`)
 *     scope        (array of strings)
 *     tier         ('tier_0' | 'tier_1' | 'tier_2')
 *     session_kind ('primary' | 'stepup')
 *     session_id   (ULID)
 *     auth_factors (array of strings)
 *     env          (string)
 *     exp / iat    (numeric seconds)
 *     jti          (ULID)
 *     phone_token? (opaque JWT — Phase 6 phone-token claim, not used here)
 *
 * Verification sequence on a `/v1/briefings/*` request:
 *   1. Skip if the path is not under `/v1/briefings/`.
 *   2. Read `Authorization: Bearer <jwt>` → AUTH_JWT_MISSING (401)
 *   3. Read `X-App-Id` (per OpenAPI parameters.XAppId) → AUTH_JWT_MISSING (401)
 *   4. Verify signature, iss, aud, exp via jose.jwtVerify.
 *      - bad signature / malformed / wrong iss      → AUTH_JWT_INVALID (401)
 *      - exp in past                                → AUTH_JWT_EXPIRED (401)
 *      - aud mismatch                               → AUTH_JWT_AUDIENCE (401)
 *   5. Decorate request:
 *      - request.customerJwt = { sub, scope, tier, sessionKind, jti, raw }
 *      - request.appId       = X-App-Id (so the shared idempotency plugin —
 *                              which keys on (appId, scopedKey) — works
 *                              uniformly across HMAC and BearerCustomer
 *                              auth).
 *
 * Promotion path: this verifier is identical in shape to what KP-2 and
 * TD-2 will need. Keep the surface small enough to lift to
 * `@kmv/platform-shared/fastify-customer-jwt` once a third caller exists.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';
import { errorResponse } from '@kmv/platform-shared/envelope';

const BRIEFINGS_PREFIX = '/v1/briefings';
const APP_ID_RE = /^[a-z0-9_]{2,40}$/;

export type CustomerSessionKind = 'primary' | 'stepup';
export type CustomerTier = 'tier_0' | 'tier_1' | 'tier_2';

export interface CustomerJwtClaims {
  /** Account UUID — JWT `sub`. */
  readonly sub: string;
  readonly scope: readonly string[];
  readonly tier: CustomerTier;
  readonly sessionKind: CustomerSessionKind;
  readonly jti: string;
  /** Original compact JWT — kept for debug/audit purposes only. */
  readonly raw: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    customerJwt?: CustomerJwtClaims;
  }
}

export interface CustomerJwtPluginConfig {
  /**
   * Either the result of `jose.createRemoteJWKSet(url)` (production) or a
   * `KeyLike` constructed in tests from a known public key. `jose.jwtVerify`
   * accepts both.
   */
  readonly keyResolver: JWTVerifyGetKey | KeyLike;
  readonly issuer: string;
  readonly audience: string;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function isPathUnderBriefings(url: string): boolean {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  return path === BRIEFINGS_PREFIX || path.startsWith(`${BRIEFINGS_PREFIX}/`);
}

function asStringArray(claim: unknown): readonly string[] | undefined {
  if (!Array.isArray(claim)) return undefined;
  for (const v of claim) {
    if (typeof v !== 'string') return undefined;
  }
  return claim as readonly string[];
}

function asTier(claim: unknown): CustomerTier | undefined {
  return claim === 'tier_0' || claim === 'tier_1' || claim === 'tier_2' ? claim : undefined;
}

function asSessionKind(claim: unknown): CustomerSessionKind | undefined {
  return claim === 'primary' || claim === 'stepup' ? claim : undefined;
}

const customerJwtPluginImpl: FastifyPluginAsync<CustomerJwtPluginConfig> = async (
  fastify,
  config
) => {
  fastify.addHook('preHandler', async (request, reply) => {
    if (!isPathUnderBriefings(request.url)) return;

    const authHeader = headerString(request.headers['authorization']);
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return reply
        .code(401)
        .send(
          errorResponse(
            'AUTH_JWT_MISSING',
            'Authorization header missing or not a Bearer token',
            request.requestId
          )
        );
    }

    const token = authHeader.slice('bearer '.length).trim();
    if (token.length === 0) {
      return reply
        .code(401)
        .send(errorResponse('AUTH_JWT_MISSING', 'Bearer token empty', request.requestId));
    }

    const appIdHeader = headerString(request.headers['x-app-id']);
    if (!appIdHeader || !APP_ID_RE.test(appIdHeader)) {
      return reply
        .code(401)
        .send(
          errorResponse(
            'AUTH_JWT_MISSING',
            'X-App-Id header missing or malformed',
            request.requestId
          )
        );
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, config.keyResolver as JWTVerifyGetKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
      });
      payload = verified.payload;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // jose error codes (5.x): https://github.com/panva/jose
      //   ERR_JWT_EXPIRED              — exp in past
      //   ERR_JWT_CLAIM_VALIDATION_FAILED — iss/aud/sub mismatch
      //   ERR_JWS_SIGNATURE_VERIFICATION_FAILED — bad signature
      //   ERR_JWS_INVALID / ERR_JWT_INVALID — malformed
      if (code === 'ERR_JWT_EXPIRED') {
        return reply
          .code(401)
          .send(errorResponse('AUTH_JWT_EXPIRED', 'JWT expired', request.requestId));
      }
      if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        const claim = (err as { claim?: string }).claim;
        if (claim === 'aud') {
          return reply
            .code(401)
            .send(
              errorResponse(
                'AUTH_JWT_AUDIENCE',
                'JWT audience does not include this rail',
                request.requestId
              )
            );
        }
        return reply
          .code(401)
          .send(
            errorResponse(
              'AUTH_JWT_INVALID',
              `JWT claim validation failed${claim ? ` (${claim})` : ''}`,
              request.requestId
            )
          );
      }
      return reply
        .code(401)
        .send(
          errorResponse(
            'AUTH_JWT_INVALID',
            'JWT signature or structure invalid',
            request.requestId
          )
        );
    }

    const sub = payload.sub;
    const scope = asStringArray(payload['scope']);
    const tier = asTier(payload['tier']);
    const sessionKind = asSessionKind(payload['session_kind']);
    const jti = payload.jti;

    if (!sub || !scope || !tier || !sessionKind || !jti) {
      return reply
        .code(401)
        .send(
          errorResponse(
            'AUTH_JWT_INVALID',
            'JWT missing required customer-token claims',
            request.requestId
          )
        );
    }

    (request as FastifyRequest).customerJwt = {
      sub,
      scope,
      tier,
      sessionKind,
      jti,
      raw: token,
    };
    (request as FastifyRequest).appId = appIdHeader;
    return;
  });
};

export const customerJwtPlugin = fp(customerJwtPluginImpl, {
  name: 'helpan-ai/customer-jwt',
  fastify: '4.x',
});
