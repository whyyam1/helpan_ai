import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { TenantRecord } from '@kmv/platform-shared/fastify-auth';
import { AdminScopeRequiredError, requireAdminScope } from './scopeCheck.js';

function makeRequest(tenant: TenantRecord | undefined): FastifyRequest {
  return { tenantRecord: tenant } as unknown as FastifyRequest;
}

const baseTenant = (scopes: readonly string[]): TenantRecord => ({
  app_id: 'helpan_test',
  app_name: 'test',
  tenant_class: 'internal',
  scopes,
  status: 'active',
});

describe('requireAdminScope', () => {
  it('passes when tenant has helpan:admin', () => {
    expect(() => requireAdminScope(makeRequest(baseTenant(['helpan:admin'])))).not.toThrow();
  });

  it('passes when admin is one of several scopes', () => {
    expect(() =>
      requireAdminScope(makeRequest(baseTenant(['operator:read', 'helpan:admin'])))
    ).not.toThrow();
  });

  it('throws 403 AdminScopeRequiredError when scope absent', () => {
    try {
      requireAdminScope(makeRequest(baseTenant(['operator:read'])));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdminScopeRequiredError);
      expect((err as AdminScopeRequiredError).statusCode).toBe(403);
      expect((err as AdminScopeRequiredError).code).toBe('AUTH_SCOPE_REQUIRED');
    }
  });

  it('throws an internal error when tenantRecord is missing (plugin misconfig)', () => {
    expect(() => requireAdminScope(makeRequest(undefined))).toThrow(
      /tenantRecord missing/
    );
  });
});
