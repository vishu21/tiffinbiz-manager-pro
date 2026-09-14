-- Per-day pickup vs delivery schedule support (idempotent). Paste into Supabase SQL Editor.
-- Adds a canonical boolean flag for records created under the legacy all-days
-- "Kitchen Pickup" flow plus the new per-day pickup list (full day names).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_pickup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_days text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill: legacy pickup records were stored as an address/name containing "PICKUP".
UPDATE customers
SET is_pickup = true
WHERE is_pickup = false
  AND (
    upper(coalesce(delivery_address, '')) LIKE '%PICKUP%'
    OR upper(coalesce(full_name, '')) LIKE '%PICKUP%'
  );
