-- Scheduled (future) cancellation / pause support. Idempotent.
-- Paste into Supabase SQL Editor and run (or apply via the CLI).
--
-- scheduled_cancel_date = the customer's "Last Service Date" (the date picked in the
--   Cancel / Pause modal). While the date is in the future the customer stays
--   subscription_status = 'active' and keeps appearing on the prep manifest (the kitchen
--   sees a "LAST TIFFIN" badge on the date itself).
-- scheduled_status = the status to apply once that date has passed: 'cancelled' or 'paused'.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS scheduled_cancel_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_status TEXT
    CHECK (scheduled_status IN ('cancelled', 'paused'));

CREATE INDEX IF NOT EXISTS idx_customers_scheduled_cancel_date
  ON customers (scheduled_cancel_date);

-- Flush the PostgREST schema cache so the new columns are queryable immediately
-- (same convention as 00016_notify_pgrst_reload.sql). Without this the REST layer
-- can keep answering with a stale "column ... does not exist" for a short while.
NOTIFY pgrst, 'reload schema';
