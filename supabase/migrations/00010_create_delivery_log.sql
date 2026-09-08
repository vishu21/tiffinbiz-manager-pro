-- Daily dispatch fulfillment log (idempotent). Paste into Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS customer_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  event text NOT NULL CHECK (event IN ('delivered', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, delivery_date)
);

CREATE INDEX IF NOT EXISTS idx_customer_deliveries_date ON customer_deliveries(delivery_date);
