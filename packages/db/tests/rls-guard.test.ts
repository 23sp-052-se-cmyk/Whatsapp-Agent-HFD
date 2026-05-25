/**
 * RLS Guard Test — CI build-breaker.
 *
 * Asserts that a query against any tenant table executed WITHOUT setting
 * app.current_org_id returns zero rows, even if rows exist.
 * Also asserts the positive case: the correct context unlocks the row.
 *
 * Requires:
 *   DATABASE_URL      — superuser/admin connection (bypasses RLS, used to seed)
 *   DATABASE_APP_URL  — app_user connection        (subject to RLS)
 *
 * Both env vars are set by docker-compose in local dev and by CI secrets.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(__dirname, "../../../.env") });

const ADMIN_URL =
  process.env["DATABASE_URL"] ??
  "postgres://postgres:postgres@localhost:5432/appdb";
const APP_URL =
  process.env["DATABASE_APP_URL"] ??
  "postgres://app_user:app_password@localhost:5432/appdb";

describe("RLS guard", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let testOrgId: string;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1 });
    app = postgres(APP_URL, { max: 1 });

    // Seed: create an org + a member as superuser (bypasses RLS)
    const [org] = await admin<[{ id: string }]>`
      INSERT INTO organizations (name, plan, region, status)
      VALUES ('rls-test-org', 'starter', 'ap-south-1', 'active')
      RETURNING id
    `;
    testOrgId = org!.id;

    await admin`
      INSERT INTO members (org_id, email, role, status)
      VALUES (${testOrgId}, 'rls-guard@test.local', 'owner', 'active')
    `;
  });

  afterAll(async () => {
    // Cleanup via superuser — cascades to members through FK
    await admin`DELETE FROM organizations WHERE id = ${testOrgId}`;
    await admin.end();
    await app.end();
  });

  it("returns zero rows from members when org context is not set", async () => {
    // app_user has no app.current_org_id set → RLS policy evaluates to false
    const rows = await app<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM members WHERE org_id = ${testOrgId}
    `;
    expect(rows[0]!.count).toBe("0");
  });

  it("returns zero rows from organizations when org context is not set", async () => {
    const rows = await app<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM organizations WHERE id = ${testOrgId}
    `;
    expect(rows[0]!.count).toBe("0");
  });

  it("returns rows when the correct org context is set inside a transaction", async () => {
    const members = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${testOrgId}, true)`;
      return tx<{ email: string }[]>`SELECT email FROM members`;
    });

    expect(members.length).toBeGreaterThan(0);
    expect(members[0]!.email).toBe("rls-guard@test.local");
  });

  it("context does not bleed between transactions (isolation proof)", async () => {
    // First transaction sets context and queries (positive)
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${testOrgId}, true)`;
      const rows = await tx<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM members
      `;
      expect(rows[0]!.count).toBe("1");
    });

    // Immediately after, same connection — context must be gone
    const rowsAfter = await app<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM members WHERE org_id = ${testOrgId}
    `;
    expect(rowsAfter[0]!.count).toBe("0");
  });
});
