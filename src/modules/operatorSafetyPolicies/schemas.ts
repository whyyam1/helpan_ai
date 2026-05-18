/**
 * AJV schemas for the Operator > Safety Policies endpoints.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.SafetyPolicy /
 * SafetyPolicyListResponse / SafetyPolicyResponse.
 */

const AUDIENCE_ENUM = ['family_friendly', 'general', 'adult_confirmed'] as const;
const LOCATION_ENUM = [
  'merchant_level',
  'neighbourhood_level',
  'city_level',
  'none',
] as const;
const MODERATION_KIND_ENUM = [
  'text_filter',
  'image_filter',
  'link_filter',
  'recipient_filter',
] as const;
const MODERATION_ACTION_ENUM = ['reject', 'flag', 'redact'] as const;

export type AudiencePosture = (typeof AUDIENCE_ENUM)[number];
export type LocationPrecisionFloor = (typeof LOCATION_ENUM)[number];

export interface ContentModerationRule {
  rule_id: string;
  kind: (typeof MODERATION_KIND_ENUM)[number];
  pattern: string;
  action: (typeof MODERATION_ACTION_ENUM)[number];
}

const POLICY_ID_PATTERN = '^sfp_[0-9A-HJKMNP-TV-Z]{26}$';
const APP_ID_PATTERN = '^[a-z0-9_]{2,40}$';

const moderationRuleSchema = {
  type: 'object',
  required: ['rule_id', 'kind', 'pattern', 'action'],
  additionalProperties: false,
  properties: {
    rule_id: { type: 'string', minLength: 1, maxLength: 100 },
    kind: { type: 'string', enum: MODERATION_KIND_ENUM },
    pattern: { type: 'string', minLength: 1, maxLength: 1000 },
    action: { type: 'string', enum: MODERATION_ACTION_ENUM },
  },
} as const;

/**
 * PUT body: a full SafetyPolicy. Strict OpenAPI per H-6 plan decision 2a:
 * `id` and `app_id` must match the resource (`id` matches path; `app_id`
 * is fixed for an existing row, frozen for a new row).
 */
export const putSafetyPolicyRequestSchema = {
  $id: 'helpan-ai/PutSafetyPolicyRequest',
  type: 'object',
  required: ['id', 'app_id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: POLICY_ID_PATTERN },
    app_id: { type: 'string', pattern: APP_ID_PATTERN },
    category_whitelist: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      maxItems: 200,
    },
    category_blacklist: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      maxItems: 200,
    },
    content_moderation_rules: {
      type: 'array',
      items: moderationRuleSchema,
      maxItems: 200,
    },
    audience_posture: { type: 'string', enum: AUDIENCE_ENUM },
    location_precision_floor: { type: 'string', enum: LOCATION_ENUM, nullable: true },
  },
} as const;

const safetyPolicyObjectSchema = {
  type: 'object',
  required: ['id', 'app_id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: POLICY_ID_PATTERN },
    app_id: { type: 'string' },
    category_whitelist: { type: 'array', items: { type: 'string' } },
    category_blacklist: { type: 'array', items: { type: 'string' } },
    content_moderation_rules: { type: 'array', items: moderationRuleSchema },
    audience_posture: { type: 'string', enum: AUDIENCE_ENUM },
    location_precision_floor: { type: 'string', enum: LOCATION_ENUM, nullable: true },
    updated_at: { type: 'string', format: 'date-time' },
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

export const safetyPolicyResponseSchema = {
  $id: 'helpan-ai/SafetyPolicyResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: safetyPolicyObjectSchema,
    meta: metaSchema,
  },
} as const;

export const safetyPolicyListResponseSchema = {
  $id: 'helpan-ai/SafetyPolicyListResponse',
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
        items: { type: 'array', items: safetyPolicyObjectSchema },
      },
    },
    meta: metaSchema,
  },
} as const;

export interface SafetyPolicyDto {
  id: string;
  app_id: string;
  category_whitelist: string[];
  category_blacklist: string[];
  content_moderation_rules: ContentModerationRule[];
  audience_posture: AudiencePosture;
  location_precision_floor?: LocationPrecisionFloor | null;
  created_at: string;
  updated_at: string;
}
