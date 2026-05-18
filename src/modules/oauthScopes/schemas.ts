/**
 * AJV schemas for the OAuth tag.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.OauthScope /
 * OauthScopeListResponse / CreateOauthScopeRequest / OauthScopeResponse.
 */

const RAIL_ENUM = [
  'helpan',
  'kipkiren_pay',
  'identiti',
  'todoku',
  'lunchdrop',
  'chapaa',
  'klokd',
  'family_discovery',
] as const;

const CATEGORY_ENUM = [
  'read_aggregate',
  'read_behavioural',
  'write_money',
  'write_comms',
  'write_identity',
  'admin',
] as const;

const ELEVATION_ENUM = ['low', 'medium', 'high'] as const;
const STATUS_ENUM = ['active', 'deprecated', 'retired'] as const;

export type ScopeRail = (typeof RAIL_ENUM)[number];
export type ScopeCategory = (typeof CATEGORY_ENUM)[number];
export type ElevationFriction = (typeof ELEVATION_ENUM)[number];
export type ScopeStatus = (typeof STATUS_ENUM)[number];

export const listOauthScopesQuerySchema = {
  $id: 'helpan-ai/ListOauthScopesQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    rail: { type: 'string', enum: RAIL_ENUM },
  },
} as const;

const oauthScopeObjectSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'description',
    'rail',
    'category',
    'default_grantable',
    'elevation_friction',
    'per_scope_max_ttl_seconds',
    'status',
    'created_at',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 2000 },
    rail: { type: 'string', enum: RAIL_ENUM },
    category: { type: 'string', enum: CATEGORY_ENUM },
    default_grantable: { type: 'boolean' },
    elevation_friction: { type: 'string', enum: ELEVATION_ENUM },
    per_scope_amount_ceiling_minor: { type: 'integer', minimum: 0, nullable: true },
    per_scope_period_ceiling_minor: { type: 'integer', minimum: 0, nullable: true },
    per_scope_max_ttl_seconds: { type: 'integer', minimum: 60, maximum: 7 * 24 * 3600 },
    status: { type: 'string', enum: STATUS_ENUM },
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

export const oauthScopeListResponseSchema = {
  $id: 'helpan-ai/OauthScopeListResponse',
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
        items: { type: 'array', items: oauthScopeObjectSchema },
      },
    },
    meta: metaSchema,
  },
} as const;

export const oauthScopeResponseSchema = {
  $id: 'helpan-ai/OauthScopeResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: oauthScopeObjectSchema,
    meta: metaSchema,
  },
} as const;

export const createOauthScopeRequestSchema = {
  $id: 'helpan-ai/CreateOauthScopeRequest',
  type: 'object',
  required: ['id', 'name', 'description', 'rail', 'default_grantable', 'category'],
  additionalProperties: false,
  properties: {
    // Dotted IDs: `<rail>.<verb>.<resource>` per the catalogue convention.
    id: { type: 'string', pattern: '^[a-z_]+\\.[a-z_]+\\.[a-z_]+$', maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 2000 },
    rail: { type: 'string', enum: RAIL_ENUM },
    category: { type: 'string', enum: CATEGORY_ENUM },
    default_grantable: { type: 'boolean' },
    elevation_friction: { type: 'string', enum: ELEVATION_ENUM },
    per_scope_amount_ceiling_minor: { type: 'integer', minimum: 0, nullable: true },
    per_scope_period_ceiling_minor: { type: 'integer', minimum: 0, nullable: true },
    per_scope_max_ttl_seconds: { type: 'integer', minimum: 60, maximum: 7 * 24 * 3600 },
  },
} as const;

export interface OauthScopeDto {
  id: string;
  name: string;
  description: string;
  rail: ScopeRail;
  category: ScopeCategory;
  default_grantable: boolean;
  elevation_friction: ElevationFriction;
  per_scope_amount_ceiling_minor?: number | null;
  per_scope_period_ceiling_minor?: number | null;
  per_scope_max_ttl_seconds: number;
  status: ScopeStatus;
  created_at: string;
  updated_at?: string;
}
