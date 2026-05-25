import { AsyncLocalStorage } from 'async_hooks';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(orgId: string): void {
  if (!UUID_RE.test(orgId)) {
    throw new Error(`Invalid tenant org_id: ${orgId}`);
  }
}

const tenantStore = new AsyncLocalStorage<string>();

export function runWithTenantContext<T>(orgId: string, fn: () => T): T {
  assertUuid(orgId);
  return tenantStore.run(orgId, fn);
}

export function getTenantContext(): string {
  const orgId = tenantStore.getStore();
  if (!orgId) throw new Error('No tenant context — TenantInterceptor not active');
  return orgId;
}

export function getTenantContextOptional(): string | undefined {
  return tenantStore.getStore();
}
