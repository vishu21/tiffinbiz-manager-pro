-- Create menu_recipes table for prep dashboard dropdown selections
CREATE TABLE IF NOT EXISTS menu_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('dal', 'sabji')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed dal category
INSERT INTO menu_recipes (name, category) VALUES
  ('Channa Daal', 'dal'),
  ('Black Channa', 'dal'),
  ('Mix Daal', 'dal'),
  ('Sabut Masoor Daal', 'dal'),
  ('Urad/Channa Daal', 'dal'),
  ('Yellow Daal', 'dal')
ON CONFLICT (name) DO NOTHING;

-- Seed sabji category
INSERT INTO menu_recipes (name, category) VALUES
  ('Matar Paneer', 'sabji'),
  ('Rajma', 'sabji'),
  ('Paneer Bhurji', 'sabji'),
  ('Aloo Gobi', 'sabji'),
  ('Aloo Matar', 'sabji'),
  ('White Channa', 'sabji'),
  ('Kadhi', 'sabji'),
  ('Matar Mushroom', 'sabji'),
  ('Mix Veg', 'sabji'),
  ('Aloo Baingan', 'sabji'),
  ('Gajar Aloo Matar', 'sabji'),
  ('Aloo Shimla Mirch', 'sabji'),
  ('Bhindi', 'sabji'),
  ('Beans Aloo', 'sabji'),
  ('Aloo Nutri', 'sabji'),
  ('Saag', 'sabji')
ON CONFLICT (name) DO NOTHING;

-- Enable RLS
ALTER TABLE menu_recipes ENABLE ROW LEVEL SECURITY;

-- Allow full access for all operations (internal kitchen tool)
CREATE POLICY "Public access to menu_recipes"
  ON menu_recipes FOR ALL
  USING (true)
  WITH CHECK (true);
