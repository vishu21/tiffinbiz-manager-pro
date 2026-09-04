-- Add discount fields to the customers table
-- Run this in your Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS discount_type TEXT
    CHECK (discount_type IN ('flat', 'percent')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS discount_note TEXT;
