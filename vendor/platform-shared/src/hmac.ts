/**
 * HMAC request signing and verification.
 * Per Instruction Pack §2.3 / §4.1.
 *
 * Canonical string format (identical across all three rails):
 *   {HTTP_METHOD}\n
 *   {PATH_AND_QUERY}\n
 *   {CONTENT_TYPE}\n
 *   {X-{Rail}-Timestamp}\n
 *   {SHA256_HEX(request_body)}
 *
 * Authorization header format:
 *   {Rail}-HMAC-SHA256 app_id={appId}, signature={base64Sig}
 *
 * Constant-time signature comparison via timingSafeEqual.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface CanonicalStringParams {
  method: string;
  pathAndQuery: string;
  contentType: string;
  timestamp: string;
  bodySha256Hex: string;
}

export type RailPrefix = 'KipkirenPay' | 'Identiti' | 'Todoku' | 'Helpan';

export function buildCanonicalString(params: CanonicalStringParams): string {
  return [
    params.method.toUpperCase(),
    params.pathAndQuery,
    params.contentType,
    params.timestamp,
    params.bodySha256Hex,
  ].join('\n');
}

export function sha256Hex(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function signRequest(canonicalString: string, secret: string): string {
  return createHmac('sha256', secret).update(canonicalString, 'utf8').digest('base64');
}

export function verifyHmac(
  canonicalString: string,
  secret: string,
  provided: string
): boolean {
  const expected = signRequest(canonicalString, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ParsedAuthorizationHeader {
  railPrefix: RailPrefix;
  appId: string;
  signature: string;
}

const AUTH_HEADER_RE =
  /^(KipkirenPay|Identiti|Todoku|Helpan)-HMAC-SHA256\s+app_id=([A-Za-z0-9_.\-]+),\s*signature=([A-Za-z0-9+/=]+)$/;

export function parseAuthorizationHeader(header: string): ParsedAuthorizationHeader | null {
  const match = AUTH_HEADER_RE.exec(header.trim());
  if (!match) return null;
  return {
    railPrefix: match[1] as RailPrefix,
    appId: match[2]!,
    signature: match[3]!,
  };
}

export function verifyTimestamp(timestamp: string, toleranceSeconds: number): boolean {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  const drift = Math.abs(Date.now() - ts);
  return drift <= toleranceSeconds * 1000;
}
