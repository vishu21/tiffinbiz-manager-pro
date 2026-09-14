-- Recipe catalog + ingredient scaling factors for the Admin Recipe Management
-- screen (/admin/recipes) and the Kitchen Prep batch calculator (/prep).
--
--   recipes                – one dish per row (dal | sabji | chicken)
--   recipe_ingredients     – raw-oz scaling factor per container size (8 oz RG / 12 oz LG)
--   daily_menu_selections  – one row per date holding Today's Dal + Today's Sabji
--
-- The column names below MATCH the tables already present in this project
-- (recipes.dish_name, recipe_ingredients.ingredient_name, daily_menu_selections.date_key).
-- Every statement is idempotent AND additive: CREATE IF NOT EXISTS for a fresh
-- database plus ADD COLUMN IF NOT EXISTS repair steps, following the same pattern
-- as 00015_add_customer_daily_overrides.sql / 00016_notify_pgrst_reload.sql.
-- Paste into the Supabase SQL Editor (or apply via the CLI); the NOTIFY at the
-- end refreshes the PostgREST schema cache immediately.

-- ── recipes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_name text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS dish_name text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Repair an older 2-value (dal|sabji) CHECK so the 'chicken' category is allowed.
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('recipes') IS NOT NULL THEN
    FOR c IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'recipes'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%category%'
    LOOP
      EXECUTE format('ALTER TABLE recipes DROP CONSTRAINT %I', c.conname);
    END LOOP;
  END IF;
END $$;

ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_category_check;
ALTER TABLE recipes
  ADD CONSTRAINT recipes_category_check
  CHECK (category IN ('dal', 'sabji', 'chicken'));

-- ── recipe_ingredients ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,
  raw_oz_per_8oz numeric(10, 3) NOT NULL DEFAULT 0,
  raw_oz_per_12oz numeric(10, 3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'oz',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS ingredient_name text,
  ADD COLUMN IF NOT EXISTS raw_oz_per_8oz numeric(10, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_oz_per_12oz numeric(10, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'oz',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe
  ON recipe_ingredients (recipe_id, sort_order);

-- ── daily_menu_selections ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_menu_selections (
  date_key date PRIMARY KEY,
  dal_recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  sabji_recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_menu_selections
  ADD COLUMN IF NOT EXISTS dal_recipe_id uuid,
  ADD COLUMN IF NOT EXISTS sabji_recipe_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The app upserts with ON CONFLICT (date_key); guarantee the unique key exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_menu_selections_date_key
  ON daily_menu_selections (date_key);

-- ── RLS (internal-tool pattern, mirrors 00003_add_menu_recipes.sql) ──────────
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_menu_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to recipes" ON recipes;
CREATE POLICY "Public access to recipes"
  ON recipes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to recipe_ingredients" ON recipe_ingredients;
CREATE POLICY "Public access to recipe_ingredients"
  ON recipe_ingredients FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to daily_menu_selections" ON daily_menu_selections;
CREATE POLICY "Public access to daily_menu_selections"
  ON daily_menu_selections FOR ALL USING (true) WITH CHECK (true);

-- Refresh the PostgREST schema cache so the new/updated tables are queryable.
NOTIFY pgrst, 'reload schema';
