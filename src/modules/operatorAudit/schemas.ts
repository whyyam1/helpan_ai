/**
 * AJV schemas for the Operator > Audit endpoint.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.AuditEntry +
 * AuditLogListResponse (the spec defines list query params inline on the
 * /operator/audit operation; replicated here as `listAuditQuerySchema`).
 */

const ACCOUNT_UUID_PATTERN =
  '^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const AGENT_ID_PATTERN = '^agt_[0-9A-HJKMNP-TV-Z]{26}$';
const ACTOR_TYPE_ENUM = ['user', 'agent', 'operator', 'system'] as const;
const OUTCOME_ENUM = ['success', 'failure'] as const;
const TARGET_RAIL_ENUM = ['kipkiren_pay', 'identiti', 'todoku'] as const;
const INITIATED_BY_ENUM = ['human', 'agent', 'system'] as const;

export type ActorType = (typeof ACTOR_TYPE_ENUM)[number];
export type Outcome = (typeof OUTCOME_ENUM)[number];

/**
 * AJV `coerceTypes:false` is rail-wide, so query strings can't auto-cast to
 * integers. `limit` arrives as a string here and is parsed in the handler
 * — same pattern as `/v1/briefings` (RECAP §6.9).
 */
export const listAuditQuerySchema = {
  $id: 'helpan-ai/ListAuditQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    action: { type: 'string', minLength: 1, maxLength: 200 },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$|^500$' },
  },
} as const;

const auditEntryObjectSchema = {
  type: 'object',
  required: ['id', 'action', 'actor_type', 'actor_id', 'request_id', 'outcome', 'created_at'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    app_id: { type: 'string', nullable: true },
    actor_type: { type: 'string', enum: ACTOR_TYPE_ENUM },
    actor_id: { type: 'string' },
    agent_id: { type: 'string', nullable: true },
    delegated_authority_jti: { type: 'string', nullable: true },
    initiated_by: { type: 'string', enum: INITIATED_BY_ENUM, nullable: true },
    account_uuid: { type: 'string', nullable: true },
    action: { type: 'string' },
    resource_type: { type: 'string', nullable: true },
    resource_id: { type: 'string', nullable: true },
    target_rail: { type: 'string', enum: TARGET_RAIL_ENUM, nullable: true },
    target_operation: { type: 'string', nullable: true },
    request_id: { type: 'string' },
    traceparent: { type: 'string', nullable: true },
    outcome: { type: 'string', enum: OUTCOME_ENUM },
    detail: { type: 'object', additionalProperties: true, nullable: true },
    previous_hash: { type: 'string', nullable: true },
    entry_hash: { type: 'string' },
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

export const auditLogListResponseSchema = {
  $id: 'helpan-ai/AuditLogListResponse',
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
        items: { type: 'array', items: auditEntryObjectSchema },
        next_cursor: { type: 'string', nullable: true },
      },
    },
    meta: metaSchema,
  },
} as const;

export interface AuditEntryDto {
  id: string;
  app_id?: string | null;
  actor_type: ActorType;
  actor_id: string;
  agent_id?: string | null;
  delegated_authority_jti?: string | null;
  initiated_by?: 'human' | 'agent' | 'system' | null;
  account_uuid?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  target_rail?: 'kipkiren_pay' | 'identiti' | 'todoku' | null;
  target_operation?: string | null;
  request_id: string;
  traceparent?: string | null;
  outcome: Outcome;
  detail?: Record<string, unknown> | null;
  previous_hash?: string | null;
  entry_hash: string;
  created_at: string;
}
