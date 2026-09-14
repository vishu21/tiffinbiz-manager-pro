-- Single-Day Meal Skip + subscription-cycle extension.
--
--   is_skipped      → date-scoped skip flag on customer_daily_overrides. A row may carry
--                     ONLY this flag (every meal-config column NULL) when the day is
--                     skipped without any meal edit; the prep manifest then removes the
--                     customer from today's cooking totals / active-delivery count while
--                     still rendering the row (muted) for the packer.
--   cycle_end_date  → the last delivery day of the customer's active billing cycle. Toggling
--                     a skip extends it by ONE delivery day (Mon–Fri); restoring the meal
--                     rolls it back by one.
--
-- Idempotent. Paste into the Supabase SQL Editor (or apply via the CLI).
ALTER TABLE customer_daily_overrides
  ADD COLUMN IF NOT EXISTS is_skipped boolean NOT NULL DEFAULT false;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cycle_end_date date;
