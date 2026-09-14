-- Row Level Security policy for customer_daily_overrides.
--
-- Symptom fixed:
--   new row violates row-level security policy for table "customer_daily_overrides"
--
-- The table is written/read by the Prep dashboard through signed-in server
-- actions (supabase-js with the session token). When the table was created with
-- RLS enabled and no permissive policy, INSERT/UPDATE/DELETE are blocked.
--
-- This mirrors the repo's existing internal-tool pattern (see
-- 00003_add_menu_recipes.sql: ALTER TABLE ... ENABLE ROW LEVEL SECURITY +
-- CREATE POLICY ... FOR ALL USING (true)) so the app sessions can manage rows.
-- service_role bypasses RLS anyway; this keeps the table queryable for both the
-- anon (server-actions-without-session edge) and authenticated roles.
-- Idempotent. Paste into Supabase SQL Editor (or apply via the CLI).
ALTER TABLE customer_daily_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to customer_daily_overrides"
  ON customer_daily_overrides;
CREATE POLICY "Public access to customer_daily_overrides"
  ON customer_daily_overrides
  FOR ALL
  USING (true);
