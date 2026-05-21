/**
 * Delegated-authority service — issuance, validation, revocation.
 * Delegated Authority Contract §3 / §4 / §5.
 *
 * Issuance flow (§3.4): validate inputs → (high-stakes) verify step-up →
 * build §2.3 claims → Identiti `POST /v1/internal/sign` → persist row +
 * audit in one tx → publish AUTHORITY_ISSUED after commit.
 *
 * Validation (§4) is a pure query — never writes. Reads the DB row for
 * status/limits, verifies the token signature against Identiti's JWKS, and
 * returns `{valid, rejection_reason, …}`. HTTP is always 200 for a
 * structurally-known token; only an unknown JTI is 404 (§7.2).
 *
 * Revocation (§5) flips status active→revoked, audits, publishes
 * AUTHORITY_REVOKED. Idempotent: already-revoked → 409, expired → 409
 * (OpenAPI groups expired into 409; the contract §7.3 text is contradictory
 * — see RECAP §6 Amendment §A candidate).
 */

import { jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { appendAuditEntry } from '../../lib/auditWriter.js';
import { periodWindowKey } from '../../lib/periodWindow.js';
import {
  EVENT_AUTHORITY_ISSUED,
  EVENT_AUTHORITY_REVOKED,
  SCHEMA_VERSION,
  TOPIC_AUTHORITY_EVENTS,
} from '../../lib/kafka/topics.js';
import type { KafkaProducerLike } from '../../lib/kafka/producer.js';
import type { Db } from '../../db/client.js';
import type { DelegatedAuthoritySigner } from '../../lib/identitiSigner.js';
import type { StepUpVerifier } from '../../lib/stepUpVerifier.js';
import { getAgentById } from '../operatorAgents/repo.js';
import { getScopeById } from '../oauthScopes/repo.js';
import { buildDelegatedAuthorityClaims, type ClaimScope } from './claimBuilder.js';
import {
  classifyScope,
  requiresStepUp,
  tightestTtlSeconds,
  type ScopeClassification,
} from './scopeClassifier.js';
import {
  getAuthorityById,
  getPeriodUsageMinor,
  insertAuthority,
  listAuthorities,
  revokeActiveAuthority,
  type DelegatedAuthorityRow,
} from './repo.js';
import type {
  AuthorityDto,
  AuthorityScopeDto,
  AuthorityStatus,
  RejectionReason,
  RevocationReason,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface AuthorityAuditContext {
  readonly appId: string;
  readonly requestId: string;
  readonly traceparent?: string;
  /**
   * 'customer' when the call arrived through the Helpan Console (customer
   * JWT); 'service' for an HMAC consuming-app server / operator. Default
   * 'service'. Customer calls audit as `actor_type='user'` with the
   * `helpan_console.*` action names (Console spec §5); service calls keep
   * `actor_type='system'` + the `authority.*` actions.
   */
  readonly caller?: 'service' | 'customer';
  /** The customer's Account UUID — required when `caller='customer'`. */
  readonly callerAccountUuid?: string;
}

export class AuthorityError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly field?: string;
  constructor(code: string, statusCode: number, message: string, field?: string) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    if (field !== undefined) this.field = field;
  }
}

function toDto(row: DelegatedAuthorityRow, includeToken?: string): AuthorityDto {
  const dto: AuthorityDto = {
    id: row.id,
    account_uuid: row.accountUuid,
    agent_id: row.agentId,
    scopes: row.scopes,
    status: row.status,
    expires_at: row.expiresAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    revocation_reason: row.revocationReason,
    created_at: row.issuedAt.toISOString(),
  };
  if (includeToken !== undefined) dto.token = includeToken;
  return dto;
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssuanceDeps {
  readonly db: Db;
  readonly signer?: DelegatedAuthoritySigner;
  readonly stepUpVerifier: StepUpVerifier;
  readonly issuer: string;
  readonly helpanAudience: string;
  readonly daKid: string;
  readonly kafka?: KafkaProducerLike;
}

export interface IssueAuthorityArgs {
  readonly accountUuid: string;
  readonly agentId: string;
  readonly scopes: readonly AuthorityScopeDto[];
  readonly ttlSeconds: number;
  readonly stepUpToken?: string;
}

export interface IssueAuthorityResult {
  readonly dto: AuthorityDto;
}

export async function issueAuthority(
  deps: IssuanceDeps,
  audit: AuthorityAuditContext,
  args: IssueAuthorityArgs
): Promise<IssueAuthorityResult> {
  if (!deps.signer) {
    throw new AuthorityError(
      'ISSUANCE_UNAVAILABLE',
      503,
      'Delegated-authority issuance is not configured (IDENTITI_INTERNAL_SIGN_URL unset)'
    );
  }

  // 1. Agent must exist and be active.
  const agent = await getAgentById(deps.db, args.agentId);
  if (!agent || agent.status !== 'active') {
    throw new AuthorityError(
      'AGENT_INVALID',
      400,
      `Agent ${args.agentId} is unknown or not active`,
      'agent_id'
    );
  }

  // 2 + 3. Resolve + classify each scope.
  const classifications: ScopeClassification[] = [];
  const scopeRails: Record<string, string> = {};
  for (const s of args.scopes) {
    const row = await getScopeById(deps.db, s.scope_id);
    if (!row || row.status !== 'active') {
      throw new AuthorityError(
        'SCOPE_INVALID',
        400,
        `Scope ${s.scope_id} is unknown or not active`,
        'scopes'
      );
    }
    classifications.push(classifyScope(row));
    scopeRails[s.scope_id] = row.rail;
  }

  // 4. TTL must not exceed the tightest per-scope ceiling.
  const ttlMax = tightestTtlSeconds(classifications);
  if (args.ttlSeconds > ttlMax) {
    throw new AuthorityError(
      'TTL_EXCEEDS_MAX',
      400,
      `ttl_seconds ${args.ttlSeconds} exceeds the tightest per-scope maximum ${ttlMax}`,
      'ttl_seconds'
    );
  }

  // 5. Per-scope amount / period ceilings.
  const classById = new Map(classifications.map((c) => [c.scopeId, c]));
  for (const s of args.scopes) {
    const c = classById.get(s.scope_id)!;
    if (
      s.amount_limit_minor !== undefined &&
      c.amountCeilingMinor !== null &&
      BigInt(s.amount_limit_minor) > c.amountCeilingMinor
    ) {
      throw new AuthorityError(
        'AMOUNT_EXCEEDS_SCOPE_CEILING',
        400,
        `amount_limit_minor for ${s.scope_id} exceeds the scope ceiling`,
        'scopes'
      );
    }
    if (
      s.per_period_limit_minor !== undefined &&
      c.periodCeilingMinor !== null &&
      BigInt(s.per_period_limit_minor) > c.periodCeilingMinor
    ) {
      throw new AuthorityError(
        'AMOUNT_EXCEEDS_SCOPE_CEILING',
        400,
        `per_period_limit_minor for ${s.scope_id} exceeds the scope ceiling`,
        'scopes'
      );
    }
  }

  // 6. Step-up for high-stakes scopes.
  let stepUpJti: string | undefined;
  if (requiresStepUp(classifications)) {
    if (!args.stepUpToken) {
      throw new AuthorityError(
        'STEP_UP_REQUIRED',
        401,
        'A step-up token is required for money-touching or identity-sensitive scopes'
      );
    }
    const verified = await deps.stepUpVerifier.verify(args.stepUpToken);
    if (!verified.ok) {
      throw new AuthorityError('STEP_UP_TOKEN_INVALID', 401, verified.message);
    }
    if (verified.sub !== args.accountUuid) {
      throw new AuthorityError(
        'STEP_UP_TOKEN_INVALID',
        401,
        'Step-up token subject does not match account_uuid'
      );
    }
    stepUpJti = verified.jti;
  }

  // 7. Build the §2.3 claim set.
  const claimScopes: ClaimScope[] = args.scopes.map((s) => ({ ...s }));
  const built = buildDelegatedAuthorityClaims({
    issuer: deps.issuer,
    helpanAudience: deps.helpanAudience,
    accountUuid: args.accountUuid,
    agentId: args.agentId,
    ttlSeconds: args.ttlSeconds,
    scopes: claimScopes,
    scopeRails,
    stepUpJti,
  });

  // 8. Identiti signs.
  const signed = await deps.signer.sign({ kid: deps.daKid, claims: built.claims });
  if (!signed.ok) {
    throw new AuthorityError(
      mapSignerErrorCode(signed.code),
      signed.httpStatus,
      `Identiti signing rejected: ${signed.message}`
    );
  }

  // 9. Persist row + audit in one transaction.
  const row: DelegatedAuthorityRow = await deps.db.transaction(async (tx) => {
    const inserted = await insertAuthority(tx, {
      id: built.jti,
      accountUuid: args.accountUuid,
      agentId: args.agentId,
      scopes: args.scopes.map((s) => ({ ...s })),
      ...(stepUpJti !== undefined ? { stepUpJti } : {}),
      issuedByAppId: audit.appId,
      expiresAt: built.expiresAt,
    });
    const fromConsole = audit.caller === 'customer';
    await appendAuditEntry(tx, {
      actorType: fromConsole ? 'user' : 'system',
      actorId: fromConsole ? (audit.callerAccountUuid ?? args.accountUuid) : `app:${audit.appId}`,
      accountUuid: args.accountUuid,
      action: fromConsole ? 'helpan_console.grant' : 'authority.issue',
      resourceType: 'delegated_authority',
      resourceId: built.jti,
      // §A.11: the agent the authority empowers + the authority's own jti,
      // in their indexed columns so the cross-rail audit join resolves.
      agentId: args.agentId,
      delegatedAuthorityJti: built.jti,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'human',
      detail: {
        scope_ids: args.scopes.map((s) => s.scope_id),
        ttl_seconds: args.ttlSeconds,
        step_up_jti: stepUpJti ?? null,
      },
    });
    return inserted;
  });

  // 10. Publish AUTHORITY_ISSUED after commit.
  if (deps.kafka) {
    await deps.kafka.publish({
      topic: TOPIC_AUTHORITY_EVENTS,
      key: row.accountUuid,
      value: {
        event_id: row.id,
        event_type: EVENT_AUTHORITY_ISSUED,
        schema_version: SCHEMA_VERSION,
        occurred_at: new Date().toISOString(),
        authority_id: row.id,
        account_uuid: row.accountUuid,
        agent_id: row.agentId,
        expires_at: row.expiresAt.toISOString(),
        ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      },
    });
  }

  return { dto: toDto(row, signed.token) };
}

/** Map Identiti signer error codes to Helpan AI issuance error codes. */
function mapSignerErrorCode(identitiCode: string): string {
  switch (identitiCode) {
    case 'step_up_token_already_used':
      return 'STEP_UP_TOKEN_ALREADY_USED';
    case 'step_up_token_unknown':
    case 'step_up_token_subject_mismatch':
      return 'STEP_UP_TOKEN_INVALID';
    case 'expiry_out_of_bounds':
      return 'TTL_EXCEEDS_MAX';
    case 'customer_not_found':
      return 'ACCOUNT_NOT_FOUND';
    default:
      return 'ISSUANCE_SIGNING_FAILED';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationDeps {
  readonly db: Db;
  /** `jose.createRemoteJWKSet(...)` in production; a `KeyLike` in tests. */
  readonly daKeyResolver: JWTVerifyGetKey | KeyLike;
  readonly issuer: string;
}

export interface ValidateAuthorityArgs {
  readonly token: string;
  readonly intendedOperation: string;
  readonly amountMinor?: number;
}

export interface ValidateAuthorityResult {
  readonly valid: boolean;
  readonly status: AuthorityStatus;
  readonly scopeCovers: boolean;
  readonly withinLimits: boolean;
  readonly authority: AuthorityDto;
  readonly rejectionReason: RejectionReason | null;
}

// H-4 lifted `periodWindowKey` to `src/lib/periodWindow.ts` so the dispatch
// path can write to authority_usage using the same window scheme this
// validator reads from. Single import, identical behaviour.

export async function validateAuthority(
  deps: ValidationDeps,
  authorityId: string,
  args: ValidateAuthorityArgs
): Promise<ValidateAuthorityResult> {
  const row = await getAuthorityById(deps.db, authorityId);
  if (!row) {
    throw new AuthorityError('AUTHORITY_NOT_FOUND', 404, `No authority with id ${authorityId}`);
  }
  const now = new Date();
  const authorityDto = toDto(row);

  // Token signature verification (§4.5 token_invalid_signature).
  let tokenJti: string | undefined;
  try {
    const verified = await jwtVerify(args.token, deps.daKeyResolver as JWTVerifyGetKey, {
      issuer: deps.issuer,
      algorithms: ['RS256'],
    });
    tokenJti = typeof verified.payload.jti === 'string' ? verified.payload.jti : undefined;
  } catch {
    return reject(row, authorityDto, 'token_invalid_signature');
  }
  // A token whose jti doesn't name this resource is not valid for it.
  if (tokenJti !== authorityId) {
    return reject(row, authorityDto, 'token_invalid_signature');
  }

  // Status: revoked > expired (derived from expires_at) > active.
  if (row.status === 'revoked') {
    return reject(row, authorityDto, 'token_revoked');
  }
  if (row.expiresAt.getTime() <= now.getTime() || row.status === 'expired') {
    return {
      valid: false,
      status: 'expired',
      scopeCovers: false,
      withinLimits: false,
      authority: authorityDto,
      rejectionReason: 'token_expired',
    };
  }

  // Scope coverage. v1.0: exact match of `intended_operation` against a
  // scope_id (RECAP §6 — richer operation→scope resolver is v1.1).
  const coveringScope = row.scopes.find((s) => s.scope_id === args.intendedOperation);
  if (!coveringScope) {
    return reject(row, authorityDto, 'scope_not_covered');
  }

  // Limit checks (only when an amount is supplied).
  let withinLimits = true;
  let limitRejection: RejectionReason | null = null;
  if (args.amountMinor !== undefined) {
    const amount = BigInt(args.amountMinor);
    if (
      coveringScope.amount_limit_minor !== undefined &&
      amount > BigInt(coveringScope.amount_limit_minor)
    ) {
      withinLimits = false;
      limitRejection = 'amount_exceeds_limit';
    } else if (coveringScope.per_period_limit_minor !== undefined) {
      const windowKey = periodWindowKey(coveringScope.period, now);
      const used = await getPeriodUsageMinor(deps.db, authorityId, coveringScope.scope_id, windowKey);
      if (used + amount > BigInt(coveringScope.per_period_limit_minor)) {
        withinLimits = false;
        limitRejection = 'period_limit_exhausted';
      }
    }
  }

  const valid = withinLimits;
  return {
    valid,
    status: 'active',
    scopeCovers: true,
    withinLimits,
    authority: authorityDto,
    rejectionReason: valid ? null : limitRejection,
  };
}

function reject(
  row: DelegatedAuthorityRow,
  authorityDto: AuthorityDto,
  reason: RejectionReason
): ValidateAuthorityResult {
  return {
    valid: false,
    status: row.status,
    scopeCovers: reason === 'amount_exceeds_limit' || reason === 'period_limit_exhausted',
    withinLimits: false,
    authority: authorityDto,
    rejectionReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export interface RevocationDeps {
  readonly db: Db;
  readonly kafka?: KafkaProducerLike;
}

export interface RevokeAuthorityArgs {
  readonly reason: RevocationReason;
  readonly detail?: string;
}

function initiatedByForReason(reason: RevocationReason): 'human' | 'agent' | 'system' {
  if (reason === 'user_initiated' || reason === 'operator_initiated') return 'human';
  return 'system';
}

export async function revokeAuthority(
  deps: RevocationDeps,
  audit: AuthorityAuditContext,
  authorityId: string,
  args: RevokeAuthorityArgs
): Promise<AuthorityDto> {
  const existing = await getAuthorityById(deps.db, authorityId);
  if (!existing) {
    throw new AuthorityError('AUTHORITY_NOT_FOUND', 404, `No authority with id ${authorityId}`);
  }
  // A Console (customer) caller may only revoke their own authority. Surface
  // a cross-customer attempt as 404 — never leak that the id exists.
  if (audit.caller === 'customer' && existing.accountUuid !== audit.callerAccountUuid) {
    throw new AuthorityError('AUTHORITY_NOT_FOUND', 404, `No authority with id ${authorityId}`);
  }
  if (existing.status === 'revoked') {
    throw new AuthorityError(
      'AUTHORITY_ALREADY_REVOKED',
      409,
      `Authority ${authorityId} is already revoked`
    );
  }
  if (existing.status === 'expired' || existing.expiresAt.getTime() <= Date.now()) {
    throw new AuthorityError(
      'AUTHORITY_EXPIRED',
      409,
      `Authority ${authorityId} has already expired`
    );
  }

  const now = new Date();
  const row: DelegatedAuthorityRow = await deps.db.transaction(async (tx) => {
    const revoked = await revokeActiveAuthority(tx, authorityId, {
      reason: args.reason,
      detail: args.detail ?? null,
      revokedAt: now,
    });
    if (!revoked) {
      // Lost a race with a concurrent revoke — surface as already-revoked.
      throw new AuthorityError(
        'AUTHORITY_ALREADY_REVOKED',
        409,
        `Authority ${authorityId} is already revoked`
      );
    }
    const fromConsole = audit.caller === 'customer';
    await appendAuditEntry(tx, {
      actorType: fromConsole ? 'user' : 'system',
      actorId: fromConsole
        ? (audit.callerAccountUuid ?? revoked.accountUuid)
        : `app:${audit.appId}`,
      accountUuid: revoked.accountUuid,
      action: fromConsole ? 'helpan_console.revoke' : 'authority.revoke',
      resourceType: 'delegated_authority',
      resourceId: authorityId,
      agentId: revoked.agentId,
      delegatedAuthorityJti: authorityId,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: initiatedByForReason(args.reason),
      detail: {
        reason: args.reason,
        ...(args.detail !== undefined ? { detail: args.detail } : {}),
      },
    });
    return revoked;
  });

  if (deps.kafka) {
    await deps.kafka.publish({
      topic: TOPIC_AUTHORITY_EVENTS,
      key: row.accountUuid,
      value: {
        event_id: row.id,
        event_type: EVENT_AUTHORITY_REVOKED,
        schema_version: SCHEMA_VERSION,
        occurred_at: now.toISOString(),
        authority_id: row.id,
        account_uuid: row.accountUuid,
        agent_id: row.agentId,
        reason: args.reason,
        revoked_at: now.toISOString(),
        ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      },
    });
  }

  return toDto(row);
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

export async function readAuthority(db: Db, id: string): Promise<AuthorityDto | null> {
  const row = await getAuthorityById(db, id);
  return row ? toDto(row) : null;
}

export interface ListAuthoritiesArgs {
  status?: AuthorityStatus;
  agentId?: string;
  accountUuid?: string;
  cursor?: string;
  limit?: number;
}

export interface ListAuthoritiesResult {
  readonly items: readonly AuthorityDto[];
  readonly nextCursor: string | null;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

function encodeCursor(row: DelegatedAuthorityRow): string {
  return Buffer.from(`${row.issuedAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(encoded: string): { issuedAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0 || sep === raw.length - 1) return null;
    const issuedAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(issuedAt.getTime()) || !id.startsWith('daa_')) return null;
    return { issuedAt, id };
  } catch {
    return null;
  }
}

export async function listAuthoritiesForQuery(
  db: Db,
  args: ListAuthoritiesArgs
): Promise<ListAuthoritiesResult> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  let cursorIssuedAt: Date | undefined;
  let cursorId: string | undefined;
  if (args.cursor) {
    const decoded = decodeCursor(args.cursor);
    if (!decoded) {
      throw new AuthorityError('REQ_INVALID', 400, 'Invalid pagination cursor', 'cursor');
    }
    cursorIssuedAt = decoded.issuedAt;
    cursorId = decoded.id;
  }
  const rows = await listAuthorities(db, {
    limit: limit + 1,
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
    ...(args.accountUuid !== undefined ? { accountUuid: args.accountUuid } : {}),
    ...(cursorIssuedAt !== undefined ? { cursorIssuedAt } : {}),
    ...(cursorId !== undefined ? { cursorId } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = hasMore ? page[page.length - 1] : undefined;
  return {
    items: page.map((r) => toDto(r)),
    nextCursor: lastRow ? encodeCursor(lastRow) : null,
  };
}
