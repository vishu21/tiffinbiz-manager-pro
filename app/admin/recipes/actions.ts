'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE CATALOG ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
// Backs the Admin Recipe Management screen (/admin/recipes) and the Kitchen
// Prep batch calculator (/prep). Reads/writes:
//   • public.recipes             – the dish (dal | sabji | chicken)
//   • public.recipe_ingredients  – raw-oz scaling factors per container size
//
// Migration 00020 may not be applied yet on a given database. Every read
// degrades to an empty result and every write returns schemaAvailable:false
// (mirroring the customer_daily_overrides handling in app/prep/actions.ts) so
// the screens never crash on an older schema.
// ─────────────────────────────────────────────────────────────────────────────

export type RecipeCategory = 'dal' | 'sabji' | 'chicken';

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  name: string;
  raw_oz_per_8oz: number;
  raw_oz_per_12oz: number;
  sort_order: number;
};

// Ingredient as sent by the Recipe Manager modal. `id` is present only when an
// EXISTING ingredient row is being edited (a new row is inserted instead).
export type RecipeIngredientInput = {
  id?: string | null;
  name: string;
  raw_oz_per_8oz: number;
  raw_oz_per_12oz: number;
};

export type RecipeWithIngredients = {
  id: string;
  name: string;
  category: RecipeCategory;
  is_active: boolean;
  created_at: string | null;
  ingredients: RecipeIngredient[];
};

export type UpsertRecipeInput = {
  id?: string | null;
  name: string;
  category: RecipeCategory;
  ingredients: RecipeIngredientInput[];
};

export type UpsertRecipeResult = {
  success: boolean;
  id?: string;
  // false when the recipes tables are missing OR the PostgREST schema cache is stale.
  schemaAvailable: boolean;
  message?: string;
};

export type DeleteRecipeResult = {
  success: boolean;
  schemaAvailable: boolean;
  message?: string;
};

const RECIPE_CATEGORIES: RecipeCategory[] = ['dal', 'sabji', 'chicken'];

const SCHEMA_UNAVAILABLE_MESSAGE =
  'The recipes catalog is unavailable — apply migration 00020_add_recipes_and_daily_menu_selections.sql and reload the schema.';

// PostgREST emits PGRST204/PGRST205 for a stale schema cache and Postgres reports
// 42P01/42703 when a relation/column genuinely does not exist.
const isMissingRecipeSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  if (['PGRST204', 'PGRST205', '42P01', '42703'].includes(e.code || '')) return true;
  return (
    text.includes('does not exist') ||
    text.includes('could not find the table') ||
    text.includes('could not find the column') ||
    text.includes('schema cache') ||
    text.includes('undefined_table') ||
    text.includes('undefined_column')
  );
};

// Postgres `numeric` may arrive as a string over PostgREST — always coerce.
const toFiniteNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const capitalizeName = (name: string): string =>
  (name || '').trim().replace(/\b\w/g, c => c.toUpperCase());

const isRecipeCategory = (value: unknown): value is RecipeCategory =>
  RECIPE_CATEGORIES.includes(value as RecipeCategory);

// ── Read ─────────────────────────────────────────────────────────────────────
// Returns every recipe grouped with its ingredient rows (sorted by sort_order).
export async function getRecipesWithIngredients(): Promise<RecipeWithIngredients[]> {
  const supabase = await createClient();

  // `select('*')` keeps this resilient to schema drift: optional columns such as
  // `is_active` (added by migration 00020) are read only when present, so an
  // older `recipes` table never breaks the query.
  const selectRecipes = () =>
    supabase.from('recipes').select('*').order('dish_name', { ascending: true });

  let recipesResult = await selectRecipes();

  // The tables may exist while PostgREST still holds a STALE schema cache — try
  // ONE automatic schema reload and retry before degrading.
  if (recipesResult.error && isMissingRecipeSchemaError(recipesResult.error)) {
    const { error: reloadError } = await supabase.rpc('notify_pgrst_reload');
    if (!reloadError) {
      await new Promise(resolve => setTimeout(resolve, 400));
      recipesResult = await selectRecipes();
    }
  }

  if (recipesResult.error) {
    console.warn(
      '[Recipes] recipes unavailable — returning an empty catalog:',
      recipesResult.error.message
    );
    return [];
  }

  const recipeRows = (recipesResult.data || []) as unknown as {
    id: string;
    dish_name: string;
    category: string;
    is_active?: boolean | null;
    created_at: string | null;
  }[];

  const { data: ingredientRows, error: ingredientsError } = await supabase
    .from('recipe_ingredients')
    .select('*');

  if (ingredientsError) {
    console.warn('[Recipes] recipe_ingredients unavailable:', ingredientsError.message);
  }

  const ingredientsByRecipe = new Map<string, RecipeIngredient[]>();
  for (const row of (ingredientRows || []) as unknown as {
    id: string;
    recipe_id: string;
    ingredient_name?: string | null;
    raw_oz_per_8oz: unknown;
    raw_oz_per_12oz: unknown;
    sort_order?: unknown;
  }[]) {
    const list = ingredientsByRecipe.get(row.recipe_id) || [];
    list.push({
      id: row.id,
      recipe_id: row.recipe_id,
      name: row.ingredient_name || '',
      raw_oz_per_8oz: toFiniteNumber(row.raw_oz_per_8oz),
      raw_oz_per_12oz: toFiniteNumber(row.raw_oz_per_12oz),
      sort_order: toFiniteNumber(row.sort_order),
    });
    ingredientsByRecipe.set(row.recipe_id, list);
  }

  // Preserve the order the kitchen entered the ingredients in (stable sort keeps
  // insertion order when sort_order is absent/zero). 
  for (const list of ingredientsByRecipe.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }

  return recipeRows.map(row => ({
    id: row.id,
    name: row.dish_name,
    category: isRecipeCategory(row.category) ? row.category : 'sabji',
    is_active: row.is_active !== false,
    created_at: row.created_at ?? null,
    ingredients: ingredientsByRecipe.get(row.id) || [],
  }));
}

// ── Write ────────────────────────────────────────────────────────────────────
// Upserts the dish row and REPLACES/UPSERTS its ingredient rows: incoming rows
// that carry an id are updated, new rows are inserted, and any ingredient that is
// no longer present is deleted.
export async function upsertRecipe(input: UpsertRecipeInput): Promise<UpsertRecipeResult> {
  const supabase = await createClient();

  const name = capitalizeName(input.name);
  const category: RecipeCategory = isRecipeCategory(input.category) ? input.category : 'sabji';

  if (!name) {
    return { success: false, schemaAvailable: true, message: 'Dish name cannot be empty.' };
  }

  // Ignore blank rows so an empty "+ Add Another Ingredient" row is never saved.
  const cleanIngredients = (input.ingredients || [])
    .map(ing => ({
      id: ing.id || undefined,
      name: (ing.name || '').trim(),
      raw_oz_per_8oz: Math.max(0, toFiniteNumber(ing.raw_oz_per_8oz)),
      raw_oz_per_12oz: Math.max(0, toFiniteNumber(ing.raw_oz_per_12oz)),
    }))
    .filter(ing => ing.name.length > 0);

  const payload: Record<string, unknown> = { dish_name: name, category };
  if (input.id) payload.id = input.id;

  const { data, error } = await supabase
    .from('recipes')
    .upsert(payload, { onConflict: 'id' })
    .select('id')
    .single();

  if (error) {
    if (isMissingRecipeSchemaError(error)) {
      return { success: false, schemaAvailable: false, message: SCHEMA_UNAVAILABLE_MESSAGE };
    }
    if (error.code === '23505') {
      return {
        success: false,
        schemaAvailable: true,
        message: `"${name}" already exists in the catalog.`,
      };
    }
    console.error('Error upserting recipe:', error);
    return { success: false, schemaAvailable: true, message: error.message };
  }

  const recipeId = (data as { id: string }).id;

  // Read the existing ingredient ids so removed rows can be pruned.
  const { data: existingRows, error: existingError } = await supabase
    .from('recipe_ingredients')
    .select('id')
    .eq('recipe_id', recipeId);

  if (existingError && isMissingRecipeSchemaError(existingError)) {
    return { success: false, schemaAvailable: false, message: SCHEMA_UNAVAILABLE_MESSAGE, id: recipeId };
  }

  const existingIds = new Set(
    ((existingRows || []) as unknown as { id: string }[]).map(row => row.id)
  );
  const keptIds = new Set<string>();

  if (cleanIngredients.length > 0) {
    const buildRows = (includeOrder: boolean) =>
      cleanIngredients.map((ing, index) => {
        if (ing.id) keptIds.add(ing.id);
        return {
          ...(ing.id ? { id: ing.id } : {}),
          recipe_id: recipeId,
          ingredient_name: ing.name,
          raw_oz_per_8oz: ing.raw_oz_per_8oz,
          raw_oz_per_12oz: ing.raw_oz_per_12oz,
          ...(includeOrder ? { sort_order: index } : {}),
        };
      });

    let { error: ingredientsError } = await supabase
      .from('recipe_ingredients')
      .upsert(buildRows(true), { onConflict: 'id' });

    // Older recipe_ingredients tables have no sort_order column — retry without it.
    if (ingredientsError && /sort_order/i.test(ingredientsError.message || '')) {
      ({ error: ingredientsError } = await supabase
        .from('recipe_ingredients')
        .upsert(buildRows(false), { onConflict: 'id' }));
    }

    if (ingredientsError) {
      console.error('Error upserting recipe ingredients:', ingredientsError);
      return {
        success: false,
        schemaAvailable: !isMissingRecipeSchemaError(ingredientsError),
        id: recipeId,
        message: ingredientsError.message,
      };
    }
  }

  const removedIds = [...existingIds].filter(id => !keptIds.has(id));
  if (removedIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('recipe_ingredients')
      .delete()
      .in('id', removedIds);
    if (deleteError) {
      console.warn('[Recipes] Failed to prune removed ingredients:', deleteError.message);
    }
  }

  revalidatePath('/admin/recipes');
  revalidatePath('/prep');

  return { success: true, id: recipeId, schemaAvailable: true };
}

// Deletes a dish. The children are removed explicitly so the cascade works even
// when the database defined recipe_ingredients.recipe_id without ON DELETE CASCADE,
// and any daily menu pointer is detached first (the FK may not be SET NULL).
export async function deleteRecipe(recipeId: string): Promise<DeleteRecipeResult> {
  const supabase = await createClient();

  const { error: ingredientsError } = await supabase
    .from('recipe_ingredients')
    .delete()
    .eq('recipe_id', recipeId);
  if (ingredientsError && !isMissingRecipeSchemaError(ingredientsError)) {
    console.warn('[Recipes] Could not clear ingredients before delete:', ingredientsError.message);
  }

  await supabase
    .from('daily_menu_selections')
    .update({ dal_recipe_id: null })
    .eq('dal_recipe_id', recipeId);
  await supabase
    .from('daily_menu_selections')
    .update({ sabji_recipe_id: null })
    .eq('sabji_recipe_id', recipeId);

  const { error } = await supabase.from('recipes').delete().eq('id', recipeId);

  if (error) {
    if (isMissingRecipeSchemaError(error)) {
      return { success: false, schemaAvailable: false, message: SCHEMA_UNAVAILABLE_MESSAGE };
    }
    console.error('Error deleting recipe:', error);
    return { success: false, schemaAvailable: true, message: error.message };
  }

  revalidatePath('/admin/recipes');
  revalidatePath('/prep');

  return { success: true, schemaAvailable: true };
}

export async function duplicateRecipe(recipeId: string): Promise<{ success: boolean; message?: string; newRecipeId?: string }> {
  try {
    const { createClient } = await import('@/utils/supabase/server');
    const supabase = await createClient();

    // 1. Fetch original recipe
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .select('dish_name, category')
      .eq('id', recipeId)
      .single();

    if (recipeError || !recipe) {
      return { success: false, message: 'Original recipe could not be found.' };
    }

    // 2. Fetch original ingredients
    const { data: ingredients, error: ingError } = await supabase
      .from('recipe_ingredients')
      .select('ingredient_name, raw_oz_per_8oz, raw_oz_per_12oz, unit, sort_order')
      .eq('recipe_id', recipeId)
      .order('sort_order', { ascending: true });

    if (ingError) {
      return { success: false, message: 'Failed to read ingredients to duplicate.' };
    }

    // 3. Insert copied recipe record
    const { data: newRecipe, error: createError } = await supabase
      .from('recipes')
      .insert({
        dish_name: `${recipe.dish_name} - Copy`,
        category: recipe.category,
      })
      .select('id')
      .single();

    if (createError || !newRecipe) {
      return { success: false, message: createError?.message || 'Failed to clone recipe.' };
    }

    // 4. Insert cloned ingredients
    if (ingredients && ingredients.length > 0) {
      const clonedIngredients = ingredients.map((ing, idx) => ({
        recipe_id: newRecipe.id,
        ingredient_name: ing.ingredient_name,
        raw_oz_per_8oz: ing.raw_oz_per_8oz,
        raw_oz_per_12oz: ing.raw_oz_per_12oz,
        unit: ing.unit ?? null,
        sort_order: ing.sort_order ?? idx,
      }));

      const { error: insertIngError } = await supabase
        .from('recipe_ingredients')
        .insert(clonedIngredients);

      if (insertIngError) {
        return { success: false, message: 'Recipe created, but ingredients failed to copy.' };
      }
    }

    return { success: true, newRecipeId: newRecipe.id };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Unknown duplication error.' };
  }
}