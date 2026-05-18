/**
 * Standard response envelope used by all three rails.
 * Per Instruction Pack §2.5; Reboot Pack §9.4.
 */

import { generateUlid } from './ulid.js';

export const SCHEMA_VERSION = '1.0' as const;

export interface Meta {
  request_id: string;
  timestamp: string;
  schema_version: typeof SCHEMA_VERSION;
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  meta: Meta;
}

export interface ErrorBody {
  code: string;
  message: string;
  field?: string | null;
  detail?: Record<string, unknown>;
  documentation_url?: string;
}

export interface ErrorEnvelope {
  ok: false;
  error: ErrorBody;
  meta: Meta;
}

export interface ErrorOpts {
  field?: string | null;
  detail?: Record<string, unknown>;
  documentationUrl?: string;
}

function buildMeta(requestId?: string): Meta {
  return {
    request_id: requestId ?? generateUlid(),
    timestamp: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
}

export function successResponse<T>(data: T, requestId?: string): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    meta: buildMeta(requestId),
  };
}

export function errorResponse(
  code: string,
  message: string,
  requestId?: string,
  opts: ErrorOpts = {}
): ErrorEnvelope {
  const error: ErrorBody = { code, message };
  if (opts.field !== undefined) error.field = opts.field;
  if (opts.detail !== undefined) error.detail = opts.detail;
  if (opts.documentationUrl !== undefined) error.documentation_url = opts.documentationUrl;

  return {
    ok: false,
    error,
    meta: buildMeta(requestId),
  };
}
