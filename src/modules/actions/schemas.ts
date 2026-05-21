/**
 * AJV schemas for the Actions tag (H-4).
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas — DispatchActionRequest,
 * Action, ActionResponse, ActionListResponse.
 *
 * **AGENT_ID pattern relaxed.** OpenAPI specifies `^agt_[0-9A-HJKMNP-TV-Z]{26}$`,
 * but H-8c admitted `helpan-kws-v1` as a stable cross-rail name (project rule
 * `project-stable-agent-ids`). The rail-local pattern admits both shapes:
 * the H-3 / H-6 mint-fresh path keeps generating `agt_<ULID>` IDs; cross-rail
 * named agents like `helpan-kws-v1` validate too. Flag in RECAP §6 as an
 * Amendment §A candidate against the OpenAPI spec.
 */

const ACCOUNT_UUID_PATTERN =
  '^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const ACTION_ID_PATTERN = '^act_[0-9A-HJKMNP-TV-Z]{26}$';
const AGENT_ID_PATTERN = '^[a-zA-Z0-9_-]{1,128}$';
const AUTHORITY_ID_PATTERN = '^daa_[0-9A-HJKMNP-TV-Z]{26}$';
const TRACEPARENT_PATTERN = '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$';
const BUSINESS_OP_ID_PATTERN = '^[a-zA-Z0-9_.:-]{8,128}$';

export const TARGET_RAIL_ENUM = ['kipkiren_pay', 'identiti', 'todoku'] as const;
export const ACTION_STATUS_ENUM = ['pending', 'completed', 'failed'] as const;
export const INITIATED_BY_ENUM = ['human', 'agent', 'system'] as const;

export type ActionTargetRail = (typeof TARGET_RAIL_ENUM)[number];
export type ActionStatus = (typeof ACTION_STATUS_ENUM)[number];
export type ActionInitiatedBy = (typeof INITIATED_BY_ENUM)[number];

export const dispatchActionRequestSchema = {
  $id: 'helpan-ai/DispatchActionRequest',
  type: 'object',
  required: ['account_uuid', 'target_rail', 'target_operation', 'payload'],
  additionalProperties: false,
  properties: {
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    target_rail: { type: 'string', enum: TARGET_RAIL_ENUM },
    target_operation: { type: 'string', minLength: 1, maxLength: 200 },
    payload: { type: 'object', additionalProperties: true },
    initiated_by: { type: 'string', enum: INITIATED_BY_ENUM },
    // Optional client-supplied join key. Generated if absent.
    business_op_id: { type: 'string', pattern: BUSINESS_OP_ID_PATTERN },
    // The amount being dispatched (minor units). When present, validation
    // enforces per-call and per-period ceilings on the authority.
    amount_minor: { type: 'integer', minimum: 0 },
  },
} as const;

const actionObjectSchema = {
  type: 'object',
  required: [
    'id',
    'account_uuid',
    'agent_id',
    'target_rail',
    'target_operation',
    'status',
    'initiated_by',
    'created_at',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: ACTION_ID_PATTERN },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    delegated_authority_jti: {
      type: 'string',
      pattern: AUTHORITY_ID_PATTERN,
      nullable: true,
    },
    target_rail: { type: 'string', enum: TARGET_RAIL_ENUM },
    target_operation: { type: 'string' },
    status: { type: 'string', enum: ACTION_STATUS_ENUM },
    initiated_by: { type: 'string', enum: INITIATED_BY_ENUM },
    request_payload: { type: 'object', additionalProperties: true },
    result: { type: 'object', additionalProperties: true, nullable: true },
    error_code: { type: 'string', nullable: true },
    traceparent: { type: 'string', pattern: TRACEPARENT_PATTERN, nullable: true },
    business_op_id: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    completed_at: { type: 'string', format: 'date-time', nullable: true },
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

export const actionResponseSchema = {
  $id: 'helpan-ai/ActionResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: actionObjectSchema,
    meta: metaSchema,
  },
} as const;

export const actionListResponseSchema = {
  $id: 'helpan-ai/ActionListResponse',
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
        items: { type: 'array', items: actionObjectSchema },
        next_cursor: { type: 'string', nullable: true },
      },
    },
    meta: metaSchema,
  },
} as const;

export const listActionsQuerySchema = {
  $id: 'helpan-ai/ListActionsQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ACTION_STATUS_ENUM },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    target_rail: { type: 'string', enum: TARGET_RAIL_ENUM },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$|^200$' },
  },
} as const;

export interface ActionDto {
  id: string;
  account_uuid: string;
  agent_id: string;
  delegated_authority_jti: string | null;
  target_rail: ActionTargetRail;
  target_operation: string;
  status: ActionStatus;
  initiated_by: ActionInitiatedBy;
  request_payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_code: string | null;
  traceparent: string | null;
  business_op_id: string | null;
  created_at: string;
  completed_at: string | null;
}
