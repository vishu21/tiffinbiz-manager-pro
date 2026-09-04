-- Pronthi support: optional second bread count alongside roti.
-- Mirrors the existing roti_count column (nullable integer).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pronthi_count integer;

COMMENT ON COLUMN public.customers.pronthi_count IS 'Number of pronthis (bread) per meal, alongside roti.';
