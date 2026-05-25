-- ============================================================
-- RLS Policies — tenant isolation for all 17 tenant tables.
-- Run AFTER Drizzle migrations have created the tables.
-- Idempotent: DROP … IF EXISTS before each CREATE.
--
-- Mechanism:
--   The app sets `app.current_org_id` per transaction via
--   set_config('app.current_org_id', <uuid>, true).
--   Each policy uses:
--     nullif(current_setting('app.current_org_id', true), '')::uuid
--   so a missing/empty setting returns NULL, which never equals any
--   org_id — resulting in zero rows for un-scoped connections.
--
-- Only app_user (the application role) is subject to these policies.
-- The superuser (postgres) bypasses RLS and is used by migrations only.
-- ============================================================

-- Ensure app_user has DML on all tables created so far
-- (DEFAULT PRIVILEGES in init.sql covers new tables; this catches existing ones)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ─── Helper expression (used verbatim in every USING clause) ─
-- nullif(current_setting('app.current_org_id', true), '')::uuid

-- ─── 1. organizations ────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_isolation ON organizations;
CREATE POLICY organizations_isolation ON organizations
  FOR ALL TO app_user
  USING (id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 2. members ──────────────────────────────────────────────
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_isolation ON members;
CREATE POLICY members_isolation ON members
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 3. channels ─────────────────────────────────────────────
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channels_isolation ON channels;
CREATE POLICY channels_isolation ON channels
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 4. contacts ─────────────────────────────────────────────
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_isolation ON contacts;
CREATE POLICY contacts_isolation ON contacts
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 5. conversations ────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_isolation ON conversations;
CREATE POLICY conversations_isolation ON conversations
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 6. messages ─────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_isolation ON messages;
CREATE POLICY messages_isolation ON messages
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 7. agent_configs ────────────────────────────────────────
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_configs_isolation ON agent_configs;
CREATE POLICY agent_configs_isolation ON agent_configs
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 8. knowledge_items ──────────────────────────────────────
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_items_isolation ON knowledge_items;
CREATE POLICY knowledge_items_isolation ON knowledge_items
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 9. knowledge_chunks ─────────────────────────────────────
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_chunks_isolation ON knowledge_chunks;
CREATE POLICY knowledge_chunks_isolation ON knowledge_chunks
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 10. review_items ────────────────────────────────────────
ALTER TABLE review_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_items_isolation ON review_items;
CREATE POLICY review_items_isolation ON review_items
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 11. conversation_events ─────────────────────────────────
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_events_isolation ON conversation_events;
CREATE POLICY conversation_events_isolation ON conversation_events
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 12. notification_rules ──────────────────────────────────
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_rules_isolation ON notification_rules;
CREATE POLICY notification_rules_isolation ON notification_rules
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 13. digest_schedules ────────────────────────────────────
ALTER TABLE digest_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digest_schedules_isolation ON digest_schedules;
CREATE POLICY digest_schedules_isolation ON digest_schedules
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 14. notification_logs ───────────────────────────────────
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_logs_isolation ON notification_logs;
CREATE POLICY notification_logs_isolation ON notification_logs
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 15. usage_events ────────────────────────────────────────
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_events_isolation ON usage_events;
CREATE POLICY usage_events_isolation ON usage_events
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 16. audit_logs ──────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_isolation ON audit_logs;
CREATE POLICY audit_logs_isolation ON audit_logs
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ─── 17. subscriptions ───────────────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_isolation ON subscriptions;
CREATE POLICY subscriptions_isolation ON subscriptions
  FOR ALL TO app_user
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
