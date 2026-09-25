-- Two-tier subscription renewal — LIFETIME HISTORY counters.
--
-- Tier 1 (ACTIVE CYCLE) lives on the existing columns:
--   start_date, total_tiffin_credits, used_credits, cycle_end_date, subscription_status.
--
-- Tier 2 (LIFETIME HISTORY) — audit/business records that survive cycle resets:
--   lifetime_deliveries → cumulative meals served across every completed cycle.
--   renewal_count       → how many times the customer has renewed/extended.
--
-- Both are OPTIONAL to the application: app/prep/actions.ts writes them only when
-- present and silently strips them otherwise, so the app keeps working before this
-- migration is applied. Apply it to start persisting lifetime counters.
--
-- Idempotent. Paste into the Supabase SQL Editor (or apply via the CLI).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS lifetime_deliveries INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: treat the credits already consumed in the current cycle as the
-- customer's lifetime baseline (conservative — it never invents history).
UPDATE customers
SET lifetime_deliveries = GREATEST(COALESCE(lifetime_deliveries, 0), COALESCE(used_credits, 0));

-- Ask PostgREST to pick up the new columns immediately (stale schema cache otherwise
-- reports PGRST204 "column not found in the schema cache").
NOTIFY pgrst, 'reload schema';
