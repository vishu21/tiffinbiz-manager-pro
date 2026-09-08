-- Full self-contained credit-ledger + plan/start-date migration (idempotent).
-- Paste into Supabase SQL Editor and run.
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS plan_tier TEXT CHECK (plan_tier IN ('trial', 'weekly', 'monthly')),
ADD COLUMN IF NOT EXISTS total_tiffin_credits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS used_credits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS skipped_days_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE INDEX IF NOT EXISTS idx_customers_subscription_status ON customers(subscription_status);

UPDATE customers
SET plan_tier = 'monthly',
    total_tiffin_credits = 20,
    used_credits = 0,
    skipped_days_count = 0,
    subscription_status = 'active';
