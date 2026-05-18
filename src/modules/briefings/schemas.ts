/**
 * AJV schemas (JSON Schema 2020-12) for the Briefings tag.
 *
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.Briefing /
 * CreateBriefingRequest / UpdateBriefingRequest. Kept inline so the wire
 * contract is reviewable in TypeScript at the edit site.
 *
 * `intent` is opaque JSONB on the wire — its shape varies per app and
 * briefing_type per Per-App Integration Patterns §1–§4. Validating the
 * full intent shape is the consuming app's responsibility; here we only
 * require that it is an object.
 */

const briefingTypeEnum = [
  'alert',
  'standing_basket',
  'scheduled_action',
  'threshold_watch',
] as const;
export type BriefingType = (typeof briefingTypeEnum)[number];

const briefingStatusEnum = ['active', 'paused', 'expired', 'revoked'] as const;
export type BriefingStatus = (typeof briefingStatusEnum)[number];

const ACCOUNT_UUID_PATTERN =
  '^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const BRIEFING_ID_PATTERN = '^brf_[0-9A-HJKMNP-TV-Z]{26}$';
const AGENT_ID_PATTERN = '^agt_[0-9A-HJKMNP-TV-Z]{26}$';
const APP_ID_PATTERN = '^[a-z0-9_]{2,40}$';

export const createBriefingRequestSchema = {
  $id: 'helpan-ai/CreateBriefingRequest',
  type: 'object',
  required: ['account_uuid', 'app_id', 'briefing_type', 'intent'],
  additionalProperties: false,
  properties: {
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    app_id: { type: 'string', pattern: APP_ID_PATTERN },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN },
    briefing_type: { type: 'string', enum: briefingTypeEnum },
    intent: { type: 'object', additionalProperties: true },
    expires_at: { type: 'string', format: 'date-time', nullable: true },
    app_correlation_id: { type: 'string', maxLength: 256 },
  },
} as const;

export const updateBriefingRequestSchema = {
  $id: 'helpan-ai/UpdateBriefingRequest',
  type: 'object',
  // OpenAPI defines all top-level fields as optional but the operation is
  // meaningless if every field is omitted. We accept `{}` (returns the
  // briefing unchanged) and rely on the route handler to short-circuit.
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['active', 'paused', 'expired'] },
    intent: { type: 'object', additionalProperties: true },
    expires_at: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const listBriefingsQuerySchema = {
  $id: 'helpan-ai/ListBriefingsQuery',
  type: 'object',
  additionalProperties: false,
  // `limit` arrives as a query string, which AJV (configured with
  // coerceTypes:false in app.ts to keep body validation strict) will refuse
  // to coerce to integer. Accept it as a numeric string here and parse it
  // in the handler.
  properties: {
    app_id: { type: 'string', pattern: APP_ID_PATTERN },
    status: { type: 'string', enum: briefingStatusEnum },
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
  },
} as const;

const briefingObjectSchema = {
  type: 'object',
  required: ['id', 'account_uuid', 'app_id', 'briefing_type', 'status', 'intent', 'created_at'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: BRIEFING_ID_PATTERN },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN },
    app_id: { type: 'string' },
    agent_id: { type: 'string', pattern: AGENT_ID_PATTERN, nullable: true },
    briefing_type: { type: 'string', enum: briefingTypeEnum },
    status: { type: 'string', enum: briefingStatusEnum },
    intent: { type: 'object', additionalProperties: true },
    expires_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
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

export const briefingResponseSchema = {
  $id: 'helpan-ai/BriefingResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: briefingObjectSchema,
    meta: metaSchema,
  },
} as const;

export const briefingListResponseSchema = {
  $id: 'helpan-ai/BriefingListResponse',
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
        items: { type: 'array', items: briefingObjectSchema },
        next_cursor: { type: 'string', nullable: true },
      },
    },
    meta: metaSchema,
  },
} as const;

export interface BriefingDto {
  id: string;
  account_uuid: string;
  app_id: string;
  agent_id?: string | null;
  briefing_type: BriefingType;
  status: BriefingStatus;
  intent: Record<string, unknown>;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}
