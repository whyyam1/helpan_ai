/**
 * Fastify plugin: HMAC verification for inbound rail requests.
 * Per Instruction Pack §2.7, §4.
 *
 * Verification sequence:
 *   1. Skip exempt paths (e.g. /v1/health).
 *   2. Parse Authorization header   → AUTH_HMAC_INVALID (401)
 *   3. Verify rail prefix matches   → AUTH_HMAC_INVALID (401)
 *   4. Validate timestamp window    → AUTH_TIMESTAMP_EXPIRED (401)
 *   5. Look up app credentials      → AUTH_HMAC_INVALID (401) if unknown
 *   6. Reject if app suspended      → AUTH_APP_SUSPENDED (403)
 *   7. Recompute HMAC over canonical string and compare (constant-time)
 *                                    → AUTH_HMAC_INVALID (401) on mismatch
 *   8. Attach { appId, tenantRecord } to request.
 *
 * Side-effect: replaces the default application/json parser with one that
 * also captures the raw request body on `request.rawBody`. The raw body
 * is required for HMAC computation (canonical string includes SHA-256 of
 * the bytes the client signed; serialise-then-rehash is fragile).
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  buildCanonicalString,
  parseAuthorizationHeader,
  sha256Hex,
  verifyHmac,
  verifyTimestamp,
  type RailPrefix,
} from '../hmac.js';
import { errorResponse } from '../envelope.js';

export interface TenantRecord {
  app_id: string;
  app_name: string;
  tenant_class: 'internal' | 'external';
  scopes: readonly string[];
  status: 'active' | 'suspended';
}

export interface AppCredentialStore {
  lookup(appId: string): Promise<{
    record: TenantRecord;
    hmacSecret: string;
  } | null>;
}

export interface AuthPluginConfig {
  railPrefix: RailPrefix;
  timestampHeaderName: string;
  toleranceSeconds: number;
  credentialStore: AppCredentialStore;
  /** Exact-match paths exempt from auth (e.g. /v1/health). */
  exemptPaths: readonly string[];
  /**
   * Prefix-match exemptions. Applied with `path.startsWith(prefix)`. Used
   * for path families with variable segments (e.g. /v1/inbound/, /v1/operator/)
   * which have their own per-vendor or per-operator auth surface.
   */
  exemptPrefixes?: readonly string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    appId?: string;
    tenantRecord?: TenantRecord;
  }
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function isExempt(
  url: string,
  exemptPaths: readonly string[],
  exemptPrefixes: readonly string[] = [],
): boolean {
  const path = pathOf(url);
  for (const p of exemptPaths) {
    if (path === p) return true;
  }
  for (const p of exemptPrefixes) {
    if (path.startsWith(p)) return true;
  }
  return false;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

const authPluginImpl: FastifyPluginAsync<AuthPluginConfig> = async (fastify, config) => {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      const text = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
      (req as FastifyRequest).rawBody = text;
      if (text.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  fastify.addHook('preHandler', async (request, reply) => {
    if (isExempt(request.url, config.exemptPaths, config.exemptPrefixes ?? [])) return;

    // Already authenticated by an earlier preHandler (e.g. a rail's
    // customer-JWT plugin on a dual-auth path) — stand down. The earlier
    // plugin sets `request.appId`; HMAC has nothing to add.
    if (request.appId) return;

    const authHeader = headerString(request.headers['authorization']);
    if (!authHeader) {
      return reply
        .code(401)
        .send(errorResponse('AUTH_HMAC_INVALID', 'Authorization header missing'));
    }

    const parsed = parseAuthorizationHeader(authHeader);
    if (!parsed || parsed.railPrefix !== config.railPrefix) {
      return reply
        .code(401)
        .send(errorResponse('AUTH_HMAC_INVALID', 'Authorization header malformed'));
    }

    const tsHeaderName = config.timestampHeaderName.toLowerCase();
    const tsHeader = headerString(request.headers[tsHeaderName]);
    if (!tsHeader || !verifyTimestamp(tsHeader, config.toleranceSeconds)) {
      return reply
        .code(401)
        .send(errorResponse('AUTH_TIMESTAMP_EXPIRED', 'Timestamp missing or outside tolerance'));
    }

    const creds = await config.credentialStore.lookup(parsed.appId);
    if (!creds) {
      return reply.code(401).send(errorResponse('AUTH_HMAC_INVALID', 'Unknown app_id'));
    }
    if (creds.record.status === 'suspended') {
      return reply.code(403).send(errorResponse('AUTH_APP_SUSPENDED', 'App suspended'));
    }

    const contentType = headerString(request.headers['content-type']) ?? '';
    const rawBody = request.rawBody ?? '';
    const canonical = buildCanonicalString({
      method: request.method,
      pathAndQuery: request.url,
      contentType,
      timestamp: tsHeader,
      bodySha256Hex: sha256Hex(rawBody),
    });

    if (!verifyHmac(canonical, creds.hmacSecret, parsed.signature)) {
      return reply.code(401).send(errorResponse('AUTH_HMAC_INVALID', 'Signature mismatch'));
    }

    request.appId = parsed.appId;
    request.tenantRecord = creds.record;
    return;
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'kmv-platform-shared/auth',
  fastify: '4.x',
});
