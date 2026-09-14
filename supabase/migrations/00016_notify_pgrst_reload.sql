-- notify_pgrst_reload: PostgREST schema-cache reload for the Prep "Today Only"
-- override feature (companion to 00015_add_customer_daily_overrides.sql).
--
-- Ensures the override table also exists when a database only runs this file
-- (idempotent). After applying migrations, run either:
--   SELECT notify_pgrst_reload();
-- or the equivalent raw SQL: NOTIFY pgrst, 'reload schema';
-- The app invokes the RPC automatically from app/prep/actions.ts
-- (reloadSchemaCache / getDailyOverrides retry).
CREATE TABLE IF NOT EXISTS customer_daily_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  meal_type text,
  portion_size text,
  roti_count integer,
  pronthi_count integer,
  rice_count text,
  dietary_notes text,
  delivery_instructions text,
  is_custom_curry boolean,
  curry_config text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, override_date)
);

CREATE INDEX IF NOT EXISTS idx_customer_daily_overrides_date
  ON customer_daily_overrides (override_date);

CREATE OR REPLACE FUNCTION public.notify_pgrst_reload()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NOTIFY pgrst, 'reload schema';
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_pgrst_reload() TO authenticated, service_role, anon;

-- Repair step: if customer_daily_overrides already existed with a minimal/alternate
-- column set, add the canonical meal-config columns the app reads/writes.
-- ADD COLUMN IF NOT EXISTS is a no-op when the column is already present, so this
-- file can be re-run safely (idempotent).
ALTER TABLE customer_daily_overrides
  ADD COLUMN IF NOT EXISTS meal_type text,
  ADD COLUMN IF NOT EXISTS portion_size text,
  ADD COLUMN IF NOT EXISTS roti_count integer,
  ADD COLUMN IF NOT EXISTS pronthi_count integer,
  ADD COLUMN IF NOT EXISTS rice_count text,
  ADD COLUMN IF NOT EXISTS dietary_notes text,
  ADD COLUMN IF NOT EXISTS delivery_instructions text,
  ADD COLUMN IF NOT EXISTS is_custom_curry boolean,
  ADD COLUMN IF NOT EXISTS curry_config text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The app upserts with ON CONFLICT (customer_id, override_date); guarantee the
-- unique index exists regardless of how the table was originally created.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_daily_overrides_customer_date
  ON customer_daily_overrides (customer_id, override_date);
