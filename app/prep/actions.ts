'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export async function fetchDailyMenu(dateStr: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_menus')
    .select('veg_option_1, veg_option_2, chicken_option')
    .eq('date', dateStr)
    .maybeSingle();

  if (error) {
    console.error('Error fetching daily menu:', error);
    return null;
  }

  return data
    ? {
        veg_option_1: data.veg_option_1 || '',
        veg_option_2: data.veg_option_2 || '',
        chicken_option: data.chicken_option || 'Chicken Curry',
      }
    : null;
}

export async function saveDailyMenu(
  dateStr: string,
  menuData: { veg_option_1: string; veg_option_2: string; chicken_option: string }
) {
  const supabase = await createClient();
  const { error } = await supabase.from('daily_menus').upsert(
    {
      date: dateStr,
      veg_option_1: menuData.veg_option_1,
      veg_option_2: menuData.veg_option_2,
      chicken_option: menuData.chicken_option,
    },
    { onConflict: 'date' }
  );

  if (error) {
    console.error('Error saving daily menu:', error);
    throw new Error(error.message);
  }

  revalidatePath('/prep');
}

export type Recipe = {
  id: string;
  name: string;
  category: 'dal' | 'sabji';
};

const capitalizeName = (name: string): string =>
  name.trim().replace(/\b\w/g, c => c.toUpperCase());

export async function addRecipe(name: string, category: 'dal' | 'sabji'): Promise<Recipe> {
  const supabase = await createClient();
  const cleanName = capitalizeName(name);
  if (!cleanName) throw new Error('Recipe name cannot be empty.');

  const { data, error } = await supabase
    .from('menu_recipes')
    .insert({ name: cleanName, category })
    .select('id, name, category')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`"${cleanName}" already exists in the catalog.`);
    console.error('Error adding recipe:', error);
    throw new Error(error.message);
  }

  revalidatePath('/prep');
  return data;
}

export async function updateRecipe(id: string, name: string, category: 'dal' | 'sabji'): Promise<Recipe> {
  const supabase = await createClient();
  const cleanName = capitalizeName(name);
  if (!cleanName) throw new Error('Recipe name cannot be empty.');

  const { data, error } = await supabase
    .from('menu_recipes')
    .update({ name: cleanName, category })
    .eq('id', id)
    .select('id, name, category')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`"${cleanName}" already exists in the catalog.`);
    console.error('Error updating recipe:', error);
    throw new Error(error.message);
  }

  revalidatePath('/prep');
  return data;
}

export async function deleteRecipe(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('menu_recipes').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') throw new Error('Cannot delete: this recipe is referenced in existing daily menus.');
    console.error('Error deleting recipe:', error);
    throw new Error(error.message);
  }

  revalidatePath('/prep');
}

export async function getAvailableRecipes(): Promise<{ dal: Recipe[]; sabji: Recipe[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('menu_recipes')
    .select('id, name, category')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching recipes:', error);
    return { dal: [], sabji: [] };
  }

  const dal: Recipe[] = [];
  const sabji: Recipe[] = [];

  for (const row of data || []) {
    if (row.category === 'dal') dal.push(row);
    else sabji.push(row);
  }

  return { dal, sabji };
}
