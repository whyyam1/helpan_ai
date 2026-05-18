/**
 * AJV schemas for the Events tag.
 * Mirrors helpan-ai-openapi-v1.yaml §components.schemas.IngestEventRequest /
 * IngestEventResponse.
 */

const ACCOUNT_UUID_PATTERN =
  '^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const EVENT_ID_PATTERN = '^evt_[0-9A-HJKMNP-TV-Z]{26}$';
const APP_ID_PATTERN = '^[a-z0-9_]{2,40}$';

export const ingestEventRequestSchema = {
  $id: 'helpan-ai/IngestEventRequest',
  type: 'object',
  required: ['event_type', 'app_id', 'payload'],
  additionalProperties: false,
  properties: {
    event_type: { type: 'string', minLength: 1, maxLength: 200 },
    app_id: { type: 'string', pattern: APP_ID_PATTERN },
    account_uuid: { type: 'string', pattern: ACCOUNT_UUID_PATTERN, nullable: true },
    payload: { type: 'object', additionalProperties: true },
    published_at: { type: 'string', format: 'date-time' },
    app_correlation_id: { type: 'string', maxLength: 256 },
  },
} as const;

export const ingestEventResponseSchema = {
  $id: 'helpan-ai/IngestEventResponse',
  type: 'object',
  required: ['ok', 'data', 'meta'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['event_id', 'accepted_at', 'match_count'],
      additionalProperties: false,
      properties: {
        event_id: { type: 'string', pattern: EVENT_ID_PATTERN },
        accepted_at: { type: 'string', format: 'date-time' },
        /**
         * Extension over the OpenAPI minimum: synchronous matching at H-5
         * lets us tell the caller how many briefings the event hit. This
         * is informational only — the same data lands on the Kafka topic
         * and the webhook_deliveries queue.
         */
        match_count: { type: 'integer', minimum: 0 },
      },
    },
    meta: {
      type: 'object',
      required: ['request_id', 'timestamp', 'schema_version'],
      additionalProperties: true,
      properties: {
        request_id: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        schema_version: { type: 'string', enum: ['1.0'] },
      },
    },
  },
} as const;
