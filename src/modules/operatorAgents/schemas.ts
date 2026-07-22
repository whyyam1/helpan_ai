/**
 * AJV schemas for the Operator > Agents endpoints.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.Agent +
 * RegisterAgentRequest + UpdateAgentStatusRequest + AgentResponse.
 */

const AGENT_CLASS_ENUM = ['portfolio_app', 'third_party_oauth', 'internal_system'] as const;
const AGENT_STATUS_ENUM = ['active', 'suspended', 'retired'] as const;

export type AgentClass = (typeof AGENT_CLASS_ENUM)[number];
export type AgentStatus = (typeof AGENT_STATUS_ENUM)[number];

// Relaxed 22 Jul 2026 to match actions/authorities/briefings. The response
// object echoes the stored id, so the strict pattern made `GET
// /v1/operator/agents/helpan-klokd-v1` fail RESPONSE validation (500) for
// every stable-named portfolio agent. See authorities/schemas.ts. RECAP §6.20.
const AGENT_ID_PATTERN = '^[a-zA-Z0-9_-]{1,128}$';
const APP_ID_PATTERN = '^[a-z0-9_]{2,40}$';

export const registerAgentRequestSchema = {
  $id: 'helpan-ai/RegisterAgentRequest',
  type: 'object',
  required: ['name', 'agent_class'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    agent_class: { type: 'string', enum: AGENT_CLASS_ENUM },
    owner_app_id: { type: 'string', pattern: APP_ID_PATTERN },
    third_party_oauth_client_id: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const updateAgentStatusRequestSchema = {
  $id: 'helpan-ai/UpdateAgentStatusRequest',
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: AGENT_STATUS_ENUM },
    reason: { type: 'string', maxLength: 500 },
  },
} as const;

const agentObjectSchema = {
  type: 'object',
  required: ['id', 'name', 'agent_class', 'status', 'created_at'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: AGENT_ID_PATTERN },
    name: { type: 'string' },
    agent_class: { type: 'string', enum: AGENT_CLASS_ENUM },
    owner_app_id: { type: 'string', nullable: true },
    third_party_oauth_client_id: { type: 'string', nullable: true },
    status: { type: 'string', enum: AGENT_STATUS_ENUM },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    suspended_at: { type: 'string', format: 'date-time', nullable: true },
    retired_at: { type: 'string', format: 'date-time', nullable: true },
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

export const agentResponseSchema = {
  $id: 'helpan-ai/AgentResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: agentObjectSchema,
    meta: metaSchema,
  },
} as const;

export interface AgentDto {
  id: string;
  name: string;
  agent_class: AgentClass;
  owner_app_id?: string | null;
  third_party_oauth_client_id?: string | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
  suspended_at?: string | null;
  retired_at?: string | null;
}
