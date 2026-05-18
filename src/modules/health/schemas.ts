/**
 * AJV schemas for the health endpoints.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.HealthResponse +
 * DeepHealthResponse exactly. Kept inline (not generated) so the wire
 * contract is reviewable in TypeScript at the edit site.
 */

const componentStatusEnum = ['healthy', 'degraded', 'unavailable'] as const;
export type ComponentStatus = (typeof componentStatusEnum)[number];

export const healthResponseSchema = {
  $id: 'helpan-ai/HealthResponse',
  type: 'object',
  required: ['ok', 'status', 'version'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string', enum: componentStatusEnum },
    version: { type: 'string' },
  },
} as const;

export const deepHealthResponseSchema = {
  $id: 'helpan-ai/DeepHealthResponse',
  type: 'object',
  required: ['ok', 'status', 'components'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string', enum: componentStatusEnum },
    components: {
      type: 'object',
      additionalProperties: false,
      properties: {
        database: { type: 'string', enum: componentStatusEnum },
        briefings: { type: 'string', enum: componentStatusEnum },
        events_ingest: { type: 'string', enum: componentStatusEnum },
        authorities: { type: 'string', enum: componentStatusEnum },
        kafka: { type: 'string', enum: componentStatusEnum },
        identiti: { type: 'string', enum: componentStatusEnum },
        kipkiren_pay: { type: 'string', enum: componentStatusEnum },
        todoku: { type: 'string', enum: componentStatusEnum },
        llm_provider: { type: 'string', enum: componentStatusEnum },
      },
    },
  },
} as const;

export interface HealthResponse {
  ok: boolean;
  status: ComponentStatus;
  version: string;
}

export interface DeepHealthResponse {
  ok: boolean;
  status: ComponentStatus;
  components: {
    database?: ComponentStatus;
    briefings?: ComponentStatus;
    events_ingest?: ComponentStatus;
    authorities?: ComponentStatus;
    kafka?: ComponentStatus;
    identiti?: ComponentStatus;
    kipkiren_pay?: ComponentStatus;
    todoku?: ComponentStatus;
    llm_provider?: ComponentStatus;
  };
}
