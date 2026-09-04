-- Add subscription management columns to the customers table
-- Run this in your Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active' 
    CHECK (subscription_status IN ('active', 'paused', 'cancelled')),
  ADD COLUMN IF NOT EXISTS pause_start_date DATE,
  ADD COLUMN IF NOT EXISTS pause_end_date DATE,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Create an index on subscription_status for faster filtering
CREATE INDEX IF NOT EXISTS idx_customers_subscription_status ON customers (subscription_status);

-- Create a function to check if a customer is active on a given date
CREATE OR REPLACE FUNCTION is_customer_active_on_date(customer_id UUID, check_date DATE)
RETURNS BOOLEAN AS $$
DECLARE
  cust_record RECORD;
BEGIN
  SELECT subscription_status, pause_start_date, pause_end_date 
  INTO cust_record 
  FROM customers 
  WHERE id = customer_id;
  
  -- Cancelled customers are never active
  IF cust_record.subscription_status = 'cancelled' THEN
    RETURN FALSE;
  END IF;
  
  -- Paused customers: check if check_date falls within the pause window
  IF cust_record.subscription_status = 'paused' THEN
    IF cust_record.pause_start_date IS NULL THEN
      RETURN FALSE; -- Indefinitely paused, never active
    END IF;
    
    IF check_date >= cust_record.pause_start_date THEN
      IF cust_record.pause_end_date IS NULL OR check_date <= cust_record.pause_end_date THEN
        RETURN FALSE; -- Within pause window
      END IF;
    END IF;
  END IF;
  
  RETURN TRUE; -- Default: active and delivering
END;
$$ LANGUAGE plpgsql;
