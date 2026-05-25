import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { getTenantContext, assertUuid } from './tenant-context';

export type DbSchema = typeof schema;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
  });
  return drizzle(client, { schema });
}

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/appdb';

export const db = createDb(connectionString);
export type Db = typeof db;

// Raw postgres client for migrations and scripts that bypass Drizzle
export const rawSql = postgres(connectionString, {
  max: 10,
  prepare: false,
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Wraps fn in a Drizzle transaction with SET LOCAL app.current_org_id.
 * Reads orgId from AsyncLocalStorage (set by TenantInterceptor).
 * All queries in fn run on the same connection — RLS is guaranteed to be active.
 */
export async function withTenantTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const orgId = getTenantContext();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * For use in the channel worker: explicitly pass orgId (no AsyncLocalStorage).
 */
export async function withWorkerTenantTransaction<T>(
  orgId: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  assertUuid(orgId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
