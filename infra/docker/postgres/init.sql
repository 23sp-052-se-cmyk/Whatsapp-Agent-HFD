-- ============================================================
-- PostgreSQL initialisation — runs once on first container start
-- against the database named by POSTGRES_DB (appdb)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Application role ─────────────────────────────────────
-- app_user is the role the application connects as.
-- Row-Level Security is enforced for this role.
-- Superuser (postgres) bypasses RLS — used only by migrations.
CREATE ROLE app_user LOGIN PASSWORD 'app_password';
GRANT CONNECT ON DATABASE appdb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Automatically grant DML on any table created by the superuser,
-- so we never need to re-grant after each migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
