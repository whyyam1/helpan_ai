/**
 * AJV schemas for the Authorities tag.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas — IssueAuthorityRequest,
 * ValidateAuthorityRequest, RevokeAuthorityRequest, Authority, AuthorityResponse,
 * AuthorityListResponse, ValidateAuthorityResponse.
 */

const ACCOUNT_UUID_PATTERN =
  '^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const AUTHORITY_ID_PATTERN = '^daa_[0-9A-HJKMNP-TV-Z]{26}$';
const AGENT_ID_PATTERN = '^agt_[0-9A-HJKMNP-TV-Z]{26}$';

export const PERIOD_ENUM = ['single_use', 'daily', 'weekly', 'monthly'] as const;
export const AUTHORITY_STATUS_ENUM = ['active', 'expired', 'revoked'] as const;
export const REVOCATION_REASON_ENUM = [
  'user_initiated',
  'operator_initiated',
  'account_suspended',
  'kyc_downgraded',
  'cascade_user_deleted',
  'cascade_consent_revoked',
  'security_incident',
  'other',
] as const;
export const REJECTION_REASON_ENUM = [
  'token_invalid_signature',
  'token_expired',
  'token_revoked',
  'scope_not_covered',
  'amount_exceeds_limit',
  'period_limit_exhausted',
  'account_suspended',
] as const;

export type AuthorityPeriod = (typeof PERIOD_ENUM)[number];
export type AuthorityStatus = (typeof AUTHORITY_STATUS_ENUM)[number];
export type RevocationReason = (typeof REVOCATION_REASON_ENUM)[number];
export type RejectionReason = (typeof REJECTION_REASON_ENUM)[number];

const authorityScopeSchema = {
  type: 'object',
  required: ['scope_id'],
  additionalProperties: false,
  properties: {
    scope_id: { type: 'string', minLength: 1, maxLength: 200 },
    amount_limit_minor: { type: 'integer', minimum: 0 },
    per_period_limit_minor: { type: 'integer', minimum: 0 },
    period: { type: 'string', enum: PERIOD_ENUM },
    category_whitelist: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 200 },
    recipient_whitelist: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 200 },
  },
} as const;

export const issueAuthorityRequestSchema = {
  $id: 'helpan-ai/IssueAuthorityRequest',
  type: 'object',
  required: ['account_uuid', 'agent_id', 'scopes', 'ttl_seconds'],
  additionalProperties: false,
  properties: {
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    scopes: { type: 'array', minItems: 1, maxItems: 50, items: authorityScopeSchema },
    ttl_seconds: { type: 'integer', minimum: 60, maximum: 86400 },
    step_up_token: { type: 'string', minLength: 1, maxLength: 8192 },
  },
} as const;

export const validateAuthorityRequestSchema = {
  $id: 'helpan-ai/ValidateAuthorityRequest',
  type: 'object',
  required: ['token', 'intended_operation'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 1, maxLength: 8192 },
    intended_operation: { type: 'string', minLength: 1, maxLength: 200 },
    amount_minor: { type: 'integer', minimum: 0 },
  },
} as const;

export const revokeAuthorityRequestSchema = {
  $id: 'helpan-ai/RevokeAuthorityRequest',
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string', enum: REVOCATION_REASON_ENUM },
    detail: { type: 'string', maxLength: 1000 },
  },
} as const;

const authorityObjectSchema = {
  type: 'object',
  required: ['id', 'account_uuid', 'agent_id', 'scopes', 'status', 'expires_at', 'created_at'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: AUTHORITY_ID_PATTERN },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    scopes: { type: 'array', items: authorityScopeSchema },
    status: { type: 'string', enum: AUTHORITY_STATUS_ENUM },
    token: { type: 'string' },
    expires_at: { type: 'string', format: 'date-time' },
    revoked_at: { type: 'string', format: 'date-time', nullable: true },
    revocation_reason: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

const metaSchema = {
  type: 'object',
  required: ['request_id', 'timestamp', 'schema_version'],
  additionalProperties: true,
  properties: {
    request_id: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    schema_version: { type: 'string', enum: ['1.0'] },
  },
} as const;

export const authorityResponseSchema = {
  $id: 'helpan-ai/AuthorityResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: authorityObjectSchema,
    meta: metaSchema,
  },
} as const;

export const authorityListResponseSchema = {
  $id: 'helpan-ai/AuthorityListResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: {
        // `token` is never returned on list/detail reads — issuance only.
        items: { type: 'array', items: authorityObjectSchema },
        next_cursor: { type: 'string', nullable: true },
      },
    },
    meta: metaSchema,
  },
} as const;

export const validateAuthorityResponseSchema = {
  $id: 'helpan-ai/ValidateAuthorityResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['valid', 'status', 'scope_covers', 'within_limits'],
      additionalProperties: false,
      properties: {
        valid: { type: 'boolean' },
        status: { type: 'string', enum: AUTHORITY_STATUS_ENUM },
        scope_covers: { type: 'boolean' },
        within_limits: { type: 'boolean' },
        authority: { ...authorityObjectSchema, nullable: true },
        rejection_reason: { type: 'string', enum: REJECTION_REASON_ENUM, nullable: true },
      },
    },
    meta: metaSchema,
  },
} as const;

export const listAuthoritiesQuerySchema = {
  $id: 'helpan-ai/ListAuthoritiesQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: AUTHORITY_STATUS_ENUM },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$|^200$' },
  },
} as const;

export interface AuthorityScopeDto {
  scope_id: string;
  amount_limit_minor?: number;
  per_period_limit_minor?: number;
  period?: AuthorityPeriod;
  category_whitelist?: string[];
  recipient_whitelist?: string[];
}

export interface AuthorityDto {
  id: string;
  account_uuid: string;
  agent_id: string;
  scopes: AuthorityScopeDto[];
  status: AuthorityStatus;
  token?: string;
  expires_at: string;
  revoked_at?: string | null;
  revocation_reason?: string | null;
  created_at: string;
}
