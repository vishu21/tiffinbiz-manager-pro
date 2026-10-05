-- Customer dish dislikes / exclusions.
--
--   disliked_dishes → per-customer list of dish names the customer refuses
--                     (e.g. {'Aloo Baingan','Black Channa','Karela','Paneer'}).
--                     The Kitchen Prep engine (app/prep/prepCalculations.ts)
--                     matches these against TODAY'S selected Dal/Sabji and swaps
--                     the disliked container to the other veg side:
--                       dislikes today's Sabji → that container becomes Dal (2x Dal)
--                       dislikes today's Dal   → that container becomes Sabji (2x Sabji)
--
-- Managed from the customer editor (Meal Config → Dish Exclusions) and consumed
-- on the /prep dashboard + packing manifest. Idempotent — safe to re-run.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS disliked_dishes TEXT[] DEFAULT '{}';

-- Refresh the PostgREST schema cache so the new column is immediately queryable.
NOTIFY pgrst, 'reload schema';
