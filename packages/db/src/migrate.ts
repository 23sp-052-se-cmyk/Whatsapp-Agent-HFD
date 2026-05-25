import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: join(__dirname, "../../../.env") });

function sqlId(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function sqlLit(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

async function runMigrations(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const appUrl = process.env["DATABASE_APP_URL"];
  if (!appUrl) throw new Error("DATABASE_APP_URL is required");

  const parsed = new URL(appUrl);
  const appUser = decodeURIComponent(parsed.username);
  const appPassword = decodeURIComponent(parsed.password);
  const dbName = decodeURIComponent(parsed.pathname.slice(1));

  const adminUrl = new URL(connectionString);
  const adminDbName = decodeURIComponent(adminUrl.pathname.slice(1));

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    console.log("Setting up database extensions…");
    await client.unsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await client.unsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    console.log(`Setting up role ${appUser}…`);
    await client.unsafe(`
      DO $setup$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${sqlLit(appUser)}) THEN
          EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ${sqlLit(appUser)}, ${sqlLit(appPassword)});
        ELSE
          EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', ${sqlLit(appUser)}, ${sqlLit(appPassword)});
        END IF;
      END
      $setup$
    `);

    const grantDb = dbName || adminDbName;
    await client.unsafe(`GRANT CONNECT ON DATABASE ${sqlId(grantDb)} TO ${sqlId(appUser)}`);
    await client.unsafe(`GRANT USAGE ON SCHEMA public TO ${sqlId(appUser)}`);
    await client.unsafe(`
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${sqlId(appUser)}
    `);
    await client.unsafe(`
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${sqlId(appUser)}
    `);

    console.log("Running Drizzle schema migrations…");
    await migrate(db, {
      migrationsFolder: join(__dirname, "../migrations"),
    });

    console.log("Applying RLS policies…");
    const policiesSql = readFileSync(join(__dirname, "../src/policies.sql"), "utf-8");
    await client.unsafe(policiesSql);

    console.log("Migration complete.");
  } finally {
    await client.end();
  }
}

runMigrations().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
