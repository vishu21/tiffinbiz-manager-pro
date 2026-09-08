-- Phase 1: subscription + payment tracking columns (idempotent).
-- Paste into Supabase SQL Editor and run.
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'monthly' CHECK (plan_tier IN ('trial', 'weekly', 'monthly')),
ADD COLUMN IF NOT EXISTS total_tiffin_credits INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS used_credits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS skipped_days_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid' CHECK (payment_status IN ('paid', 'due', 'overdue')),
ADD COLUMN IF NOT EXISTS start_date DATE;

UPDATE customers 
SET plan_tier = COALESCE(plan_tier, 'monthly'),
    total_tiffin_credits = COALESCE(NULLIF(total_tiffin_credits, 0), 20),
    used_credits = COALESCE(used_credits, 0),
    skipped_days_count = COALESCE(skipped_days_count, 0),
    payment_status = COALESCE(payment_status, 'paid')
WHERE plan_tier IS NULL OR payment_status IS NULL;
