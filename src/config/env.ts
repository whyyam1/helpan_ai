/**
 * Validated environment loader.
 * Throws synchronously at startup when required env vars are missing or
 * malformed — the rail must not boot in a partially-configured state.
 *
 * Loaded once via `loadConfig()`; subsequent calls return the same frozen
 * object. Fastify plugins read from this rather than from process.env directly.
 */

export type SecretsEnvelopeProvider = 'noop' | 'kms' | 'supabase-vault';

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly port: number;
  readonly serviceVersion: string;

  readonly databaseUrl: string;

  readonly auth: {
    readonly railPrefix: 'Helpan';
    readonly timestampHeaderName: string;
    readonly toleranceSeconds: number;
  };

  // Note: AUTH_RAIL_PREFIX must equal 'Helpan' (capital H) — the literal
  // value sent in the Authorization header `Helpan-HMAC-SHA256 ...`, per
  // @kmv/platform-shared's hmac.ts canonical regex.

  readonly idempotency: {
    readonly ttlSeconds: number;
  };

  readonly secrets: {
    readonly envelopeProvider: SecretsEnvelopeProvider;
  };

  readonly llm: {
    readonly provider: string | undefined;
    readonly apiKey: string | undefined;
  };

  /**
   * Identiti customer JWT trust. Helpan AI is a relying party for the
   * customer-token (BearerCustomer) issued by Identiti at /auth/customer-token,
   * verified via Identiti's JWKS at /.well-known/jwks.json. RS256, kid in
   * header. See OpenAPI §components.securitySchemes.BearerCustomer.
   *
   * H-3 adds the internal-signing leg: Helpan AI calls Identiti's
   * `POST /v1/internal/sign` (HMAC-authed, scope
   * `identiti:internal:sign:delegated_authority`) to mint delegated-authority
   * JWTs — Helpan AI never holds the signing key (H4 joint contract §2).
   */
  readonly identiti: {
    readonly jwksUrl: string;
    readonly issuer: string;
    /** Full URL of Identiti's internal signing endpoint. Empty disables issuance. */
    readonly internalSignUrl: string;
    /** HMAC secret for signing requests to Identiti (Helpan AI's tenant secret at Identiti). */
    readonly internalHmacSecret: string;
    /** Helpan AI's app_id as registered in Identiti's app_credentials. */
    readonly internalAppId: string;
    /** Timestamp header name Identiti's HMAC verifier expects. */
    readonly timestampHeader: string;
    /** Delegated-authority `kid` literal (`helpan-da-<epoch>`), Identiti-supplied. */
    readonly daKid: string;
  };

  /**
   * Audience this rail expects in the customer-JWT `aud` claim. Per OpenAPI
   * BearerCustomer description: `https://api.helpan.co.ke` in production;
   * sandbox/pre have their own audiences per the `servers` block.
   */
  readonly helpan: {
    readonly jwtAudience: string;
  };

  /**
   * Kafka producer config (H-5+). Optional: when `brokers` is empty the rail
   * runs without a producer — BRIEFING_MATCHED publishes are skipped but
   * webhook fan-out and DB-side matching still work. Deep-health surfaces
   * `kafka: unavailable` in that mode.
   */
  readonly kafka: {
    readonly brokers: readonly string[];
    readonly clientId: string;
  };
}

let cached: AppConfig | undefined;

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

function intInRange(name: string, raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]; got "${raw}"`);
  }
  return n;
}

function asNodeEnv(raw: string): AppConfig['nodeEnv'] {
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new Error(`NODE_ENV must be one of development|test|production; got "${raw}"`);
}

function asLogLevel(raw: string | undefined): AppConfig['logLevel'] {
  const v = raw ?? 'info';
  if (
    v === 'fatal' ||
    v === 'error' ||
    v === 'warn' ||
    v === 'info' ||
    v === 'debug' ||
    v === 'trace'
  ) {
    return v;
  }
  throw new Error(`LOG_LEVEL must be one of fatal|error|warn|info|debug|trace; got "${v}"`);
}

function asEnvelopeProvider(raw: string | undefined): SecretsEnvelopeProvider {
  const v = raw ?? 'noop';
  if (v === 'noop' || v === 'kms' || v === 'supabase-vault') return v;
  throw new Error(
    `SECRETS_ENVELOPE_PROVIDER must be one of noop|kms|supabase-vault; got "${v}"`
  );
}

function parseBrokerList(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function asHttpsUrl(name: string, raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL; got "${raw}"`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL; got "${raw}"`);
  }
  return raw;
}

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const railPrefix = required('AUTH_RAIL_PREFIX');
  if (railPrefix !== 'Helpan') {
    throw new Error(`AUTH_RAIL_PREFIX must be 'Helpan' for this rail; got "${railPrefix}"`);
  }

  const cfg: AppConfig = {
    nodeEnv: asNodeEnv(required('NODE_ENV')),
    logLevel: asLogLevel(optional('LOG_LEVEL')),
    port: intInRange('PORT', required('PORT'), 1, 65535),
    serviceVersion: required('SERVICE_VERSION'),

    databaseUrl: required('DATABASE_URL'),

    auth: {
      railPrefix: 'Helpan',
      timestampHeaderName: required('AUTH_TIMESTAMP_HEADER'),
      toleranceSeconds: intInRange(
        'AUTH_TIMESTAMP_TOLERANCE_SECONDS',
        required('AUTH_TIMESTAMP_TOLERANCE_SECONDS'),
        1,
        3600
      ),
    },

    idempotency: {
      ttlSeconds: intInRange(
        'IDEMPOTENCY_TTL_SECONDS',
        required('IDEMPOTENCY_TTL_SECONDS'),
        60,
        7 * 24 * 3600
      ),
    },

    secrets: {
      envelopeProvider: asEnvelopeProvider(optional('SECRETS_ENVELOPE_PROVIDER')),
    },

    llm: {
      provider: optional('LLM_PROVIDER'),
      apiKey: optional('LLM_API_KEY'),
    },

    identiti: {
      jwksUrl: asHttpsUrl('IDENTITI_JWKS_URL', required('IDENTITI_JWKS_URL')),
      issuer: required('IDENTITI_JWT_ISSUER'),
      // Issuance leg (H-3). internalSignUrl empty → POST /v1/authorities
      // returns 503; the rest of the rail runs. Required in any environment
      // that issues delegated authorities.
      internalSignUrl: optional('IDENTITI_INTERNAL_SIGN_URL') ?? '',
      internalHmacSecret: optional('IDENTITI_INTERNAL_HMAC_SECRET') ?? '',
      internalAppId: optional('HELPAN_INTERNAL_APP_ID') ?? 'helpan_ai',
      timestampHeader: optional('IDENTITI_TIMESTAMP_HEADER') ?? 'x-identiti-timestamp',
      daKid: optional('JWT_DA_KID') ?? 'helpan-da-dev',
    },

    helpan: {
      jwtAudience: required('HELPAN_JWT_AUDIENCE'),
    },

    kafka: {
      brokers: parseBrokerList(optional('KAFKA_BROKERS')),
      clientId: optional('KAFKA_CLIENT_ID') ?? 'helpan-ai-rail',
    },
  };

  cached = Object.freeze(cfg);
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
