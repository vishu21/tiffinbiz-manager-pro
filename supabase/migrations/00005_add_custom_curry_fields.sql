-- Add structured custom-curry metadata columns to the customers table
-- Run this in your Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_custom_curry BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS curry_config TEXT;
