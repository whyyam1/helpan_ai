/**
 * Admin-scope enforcement helper.
 *
 * The shared HMAC auth plugin attaches `request.tenantRecord` after signature
 * verification, including the calling app's `scopes` array. Admin endpoints
 * additionally require that the calling app holds the `helpan:admin` scope
 * — without this an HMAC-authenticated app could otherwise reach operator
 * surfaces just by signing requests correctly.
 *
 * Rail-local at H-6 per plan decision 1a; lift to `@kmv/platform-shared` when
 * KP-2/TD-2 also need scoped admin endpoints. Interface designed for
 * verbatim promotion (single function, no rail-specific types).
 */

import type { FastifyRequest } from 'fastify';

const ADMIN_SCOPE = 'helpan:admin';

export class AdminScopeRequiredError extends Error {
  readonly code = 'AUTH_SCOPE_REQUIRED';
  readonly statusCode = 403;
  readonly detail: Record<string, unknown>;
  constructor(missing: string) {
    super(`Required scope not granted: ${missing}`);
    this.detail = { required_scope: missing };
  }
}

/**
 * Throws `AdminScopeRequiredError` (mapped to 403 AUTH_SCOPE_REQUIRED by the
 * error mapper) when the calling tenant does not hold `scope`.
 *
 * Throws an internal error if `tenantRecord` is missing — that indicates
 * the route was wired without HMAC auth ahead of it, which is a
 * plugin-chain misconfiguration and should fail loudly in tests.
 */
export function requireScope(request: FastifyRequest, scope: string): void {
  const tenant = request.tenantRecord;
  if (!tenant) {
    throw new Error(
      `requireScope: request.tenantRecord missing — HMAC auth must run before ${scope} routes`
    );
  }
  if (!tenant.scopes.includes(scope)) {
    throw new AdminScopeRequiredError(scope);
  }
}

/** Convenience wrapper — `requireScope(request, 'helpan:admin')`. */
export function requireAdminScope(request: FastifyRequest): void {
  requireScope(request, ADMIN_SCOPE);
}
