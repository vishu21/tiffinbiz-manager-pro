-- 1. Create kitchen closures table
CREATE TABLE IF NOT EXISTS public.kitchen_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date DATE NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT 'Business Closure',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT DEFAULT 'admin'
);

-- 2. Ensure credit_ledger exists with proper tracking columns
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount INT NOT NULL,
  reason TEXT NOT NULL,
  closure_id UUID REFERENCES public.kitchen_closures(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes for fast lookup on prep dashboard and customer cycles
CREATE INDEX IF NOT EXISTS idx_kitchen_closures_date ON public.kitchen_closures(closure_date);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer ON public.credit_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_closure ON public.credit_ledger(closure_id);