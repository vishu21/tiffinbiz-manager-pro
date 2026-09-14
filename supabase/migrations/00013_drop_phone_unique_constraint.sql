-- Allow family members / roommates to share one contact number by removing the
-- unique constraint on customers.phone_number. Idempotent.
-- Paste into Supabase SQL Editor and run (or apply via the CLI).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_number_key;
