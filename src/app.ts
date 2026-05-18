/**
 * Fastify app factory. Exported separately from the entrypoint so tests
 * can build the app via `buildApp(...)` and exercise it with `.inject()`
 * without binding a port.
 *
 * Plugin registration order is significant:
 *   1. requestId          — every other hook reads request.requestId
 *   2. errorMapper        — installs setErrorHandler / setNotFoundHandler
 *   3. db                 — decorates app.db / app.sql (skipped if test override given)
 *   4. kafka              — decorates app.kafka (skipped if no producer supplied)
 *   5. shared HMAC auth   — verifies Authorization on HMAC-protected paths;
 *                            /v1/health is on exempt-paths; /v1/briefings is
 *                            on exempt-prefixes (it uses BearerCustomer instead).
 *   6. rail customer-JWT  — verifies BearerCustomer on /v1/briefings paths;
 *                            decorates request.customerJwt + request.appId so
 *                            the shared idempotency plugin works uniformly.
 *   7. rail RLS context   — decorates app.withCustomerContext for handlers.
 *   8. shared idempotency — relies on either HMAC or customer-JWT having set
 *                            request.appId.
 *   9. routes (under /v1) — health · briefings · events
 */

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { authPlugin } from '@kmv/platform-shared/fastify-auth';
import type { AppCredentialStore } from '@kmv/platform-shared/fastify-auth';
import { idempotencyPlugin } from '@kmv/platform-shared/fastify-idempotency';
import type { IdempotencyStore } from '@kmv/platform-shared/idempotency';
import {
  createRemoteJWKSet,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';

import type { AppConfig } from './config/env.js';
import type { Db, Sql } from './db/client.js';
import { dbPlugin } from './plugins/db.js';
import { errorMapperPlugin } from './plugins/errorMapper.js';
import { requestIdPlugin } from './plugins/requestId.js';
import { customerJwtPlugin } from './plugins/customerJwtPlugin.js';
import { rlsContextPlugin } from './plugins/rlsContext.js';
import { kafkaPlugin } from './plugins/kafkaPlugin.js';
import { createKafkajsProducer, type KafkaProducerLike } from './lib/kafka/producer.js';
import { createPgCredentialStore } from './plugins/credentialStore.js';
import { createPgIdempotencyStore } from './plugins/idempotencyStore.js';
import { createSecretsEnvelope } from './lib/secretsEnvelope.js';
import { healthRoutes } from './modules/health/routes.js';
import { briefingsRoutes } from './modules/briefings/routes.js';
import { eventsRoutes } from './modules/events/routes.js';
import { oauthScopesRoutes } from './modules/oauthScopes/routes.js';
import { operatorAgentsRoutes } from './modules/operatorAgents/routes.js';
import { operatorSafetyPoliciesRoutes } from './modules/operatorSafetyPolicies/routes.js';
import { operatorAuditRoutes } from './modules/operatorAudit/routes.js';
import { authoritiesRoutes } from './modules/authorities/routes.js';
import {
  createEnvWebhookTargetResolver,
  type WebhookTargetResolver,
} from './modules/events/service.js';
import {
  createHttpIdentitiSigner,
  type DelegatedAuthoritySigner,
} from './lib/identitiSigner.js';
import { createStepUpVerifier } from './lib/stepUpVerifier.js';

const EXEMPT_PATHS = ['/v1/health'] as const;
/**
 * Briefings use BearerCustomer (Identiti customer JWT), not HMAC. Exempt
 * the path family from the shared HMAC plugin; the rail-local customer-JWT
 * plugin verifies these requests instead.
 */
const HMAC_EXEMPT_PREFIXES = ['/v1/briefings'] as const;

export interface BuildAppOverrides {
  /** Skip dbPlugin and use these instead (for integration tests). */
  readonly dbOverride?: { db: Db; sql: Sql };
  readonly credentialStoreOverride?: AppCredentialStore;
  readonly idempotencyStoreOverride?: IdempotencyStore;
  /** Inject a key resolver for customer-JWT verification (tests). */
  readonly customerJwtKeyResolver?: JWTVerifyGetKey | KeyLike;
  /**
   * Inject the key resolver used to verify Identiti-signed step-up and
   * delegated-authority tokens (H-3). Production uses one remote JWKS set;
   * tests inject a `KeyLike` for the test keypair.
   */
  readonly identitiKeyResolver?: JWTVerifyGetKey | KeyLike;
  /** Inject the delegated-authority signer (in-process stub in tests). */
  readonly authoritySigner?: DelegatedAuthoritySigner;
  /** Inject a Kafka producer (in-memory stub in tests, kafkajs in prod). */
  readonly kafkaProducer?: KafkaProducerLike;
  /** Inject a webhook-target resolver; defaults to env-driven. */
  readonly webhookTargets?: WebhookTargetResolver;
}

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly overrides?: BuildAppOverrides;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, overrides } = opts;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // request.requestId is propagated by requestIdPlugin; we re-expose it
      // on the log line so structured logs and the response header agree.
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            requestId: (req.raw as unknown as { requestId?: string }).requestId,
          };
        },
      },
    },
    disableRequestLogging: false,
    ajv: {
      customOptions: {
        strict: 'log',
        removeAdditional: 'failing',
        useDefaults: true,
        coerceTypes: false,
      },
    },
  });

  await app.register(sensible);
  await app.register(requestIdPlugin);
  await app.register(errorMapperPlugin);

  if (overrides?.dbOverride) {
    app.decorate('db', overrides.dbOverride.db);
    app.decorate('sql', overrides.dbOverride.sql);
  } else {
    await app.register(dbPlugin, { connectionString: config.databaseUrl });
  }

  // Kafka: optional. Tests inject a stub; production wires kafkajs when
  // brokers are configured. Without brokers the rail still operates;
  // BRIEFING_MATCHED Kafka publishes are skipped and deep-health surfaces
  // kafka=unavailable.
  const kafkaProducer: KafkaProducerLike | undefined =
    overrides?.kafkaProducer ??
    (config.kafka.brokers.length > 0
      ? createKafkajsProducer({
          clientId: config.kafka.clientId,
          brokers: config.kafka.brokers,
        })
      : undefined);
  if (kafkaProducer) {
    await app.register(kafkaPlugin, { producer: kafkaProducer });
  }

  const envelope = createSecretsEnvelope(config.secrets.envelopeProvider);
  const credentialStore =
    overrides?.credentialStoreOverride ??
    createPgCredentialStore({ db: app.db, envelope });
  const idempotencyStore =
    overrides?.idempotencyStoreOverride ??
    createPgIdempotencyStore({ db: app.db });

  // One remote JWKS set serves customer-JWT, step-up, and delegated-authority
  // verification in production — all three are Identiti-signed and `jose`
  // selects the right key by `kid`. Tests inject single `KeyLike`s.
  const customerKeyResolver: JWTVerifyGetKey | KeyLike =
    overrides?.customerJwtKeyResolver ??
    createRemoteJWKSet(new URL(config.identiti.jwksUrl));
  const identitiKeyResolver: JWTVerifyGetKey | KeyLike =
    overrides?.identitiKeyResolver ??
    (overrides?.customerJwtKeyResolver
      ? customerKeyResolver
      : createRemoteJWKSet(new URL(config.identiti.jwksUrl)));

  // Customer-JWT plugin registers BEFORE the shared HMAC plugin (H-8a). On a
  // dual-auth path a verified customer JWT sets request.appId, which makes the
  // HMAC plugin stand down. On a non-Bearer request to a dual-auth path the
  // customer-JWT plugin defers and HMAC enforces.
  await app.register(customerJwtPlugin, {
    keyResolver: customerKeyResolver,
    issuer: config.identiti.issuer,
    audience: config.helpan.jwtAudience,
  });

  await app.register(authPlugin, {
    railPrefix: config.auth.railPrefix,
    timestampHeaderName: config.auth.timestampHeaderName,
    toleranceSeconds: config.auth.toleranceSeconds,
    credentialStore,
    exemptPaths: EXEMPT_PATHS,
    exemptPrefixes: HMAC_EXEMPT_PREFIXES,
  });

  await app.register(rlsContextPlugin);

  await app.register(idempotencyPlugin, {
    store: idempotencyStore,
    ttlSeconds: config.idempotency.ttlSeconds,
    protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    // POST /v1/authorities/{id}/validate is a pure query — it must not
    // consume an idempotency key (a cached validate result would break the
    // §4.6 cache rules). Exempt the `/validate` leaf by suffix.
    exemptSuffixes: ['/validate'],
  });

  const webhookTargets =
    overrides?.webhookTargets ?? createEnvWebhookTargetResolver(process.env);

  // Delegated-authority issuance leg. Signer is undefined when
  // IDENTITI_INTERNAL_SIGN_URL is unset — POST /v1/authorities then 503s.
  const authoritySigner: DelegatedAuthoritySigner | undefined =
    overrides?.authoritySigner ??
    (config.identiti.internalSignUrl
      ? createHttpIdentitiSigner({
          signUrl: config.identiti.internalSignUrl,
          hmacSecret: config.identiti.internalHmacSecret,
          appId: config.identiti.internalAppId,
          timestampHeader: config.identiti.timestampHeader,
        })
      : undefined);
  const stepUpVerifier = createStepUpVerifier({
    keyResolver: identitiKeyResolver,
    issuer: config.identiti.issuer,
  });

  await app.register(
    async (v1) => {
      await v1.register(healthRoutes, { serviceVersion: config.serviceVersion });
      await v1.register(briefingsRoutes);
      await v1.register(eventsRoutes, { webhookTargets });
      await v1.register(oauthScopesRoutes);
      await v1.register(operatorAgentsRoutes);
      await v1.register(operatorSafetyPoliciesRoutes);
      await v1.register(operatorAuditRoutes);
      await v1.register(authoritiesRoutes, {
        ...(authoritySigner ? { signer: authoritySigner } : {}),
        stepUpVerifier,
        daKeyResolver: identitiKeyResolver,
        issuer: config.identiti.issuer,
        helpanAudience: config.helpan.jwtAudience,
        daKid: config.identiti.daKid,
      });
    },
    { prefix: '/v1' }
  );

  return app;
}
