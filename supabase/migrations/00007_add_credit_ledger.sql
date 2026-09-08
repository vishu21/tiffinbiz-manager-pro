-- Safe credit-ledger migration (idempotent). Paste into Supabase SQL Editor.
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS plan_tier TEXT CHECK (plan_tier IN ('trial', 'weekly', 'monthly')),
ADD COLUMN IF NOT EXISTS total_tiffin_credits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS used_credits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS skipped_days_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'expired', 'cancelled'));

-- Create index (only if it doesn't exist)
CREATE INDEX IF NOT EXISTS idx_customers_subscription_status ON customers(subscription_status);

-- Backfill data for existing records
UPDATE customers 
SET plan_tier = 'monthly', 
    total_tiffin_credits = 20, 
    used_credits = 0, 
    skipped_days_count = 0, 
    subscription_status = 'active'
WHERE plan_tier IS NULL;
