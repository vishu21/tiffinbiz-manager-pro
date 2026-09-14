-- Repair step: databases that already created customer_daily_overrides earlier
-- (e.g. with a minimal/alternate column set) are missing the canonical meal-config
-- columns the app reads/writes. ADD COLUMN IF NOT EXISTS is a no-op when a column
-- is already present, so this file can be re-run safely against either schema.
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

-- The app upserts with ON CONFLICT (customer_id, override_date); guarantee a
-- matching unique index exists even when an earlier table was created without
-- one (or only with a different constraint).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_daily_overrides_customer_date
  ON customer_daily_overrides (customer_id, override_date);
