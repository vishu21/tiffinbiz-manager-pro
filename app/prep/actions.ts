'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { parseActiveScheduleDays } from '@/app/utils/customerPickup';
import {
  computeCycleEndDate,
  normalizeDateKey,
  resolveDeliveryDayNumbers,
  resolvePlanTierForCredits,
  shiftCycleEndByDeliveryDays,
  toLocalDateKey,
} from '@/app/utils/subscriptionCycle';
import { updateCustomerMealConfig, type MealConfigPayload } from '@/app/admin/actions';

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

// ── Daily Kitchen Menu selection (recipes catalog) ──────────────────────────────
export type DailyMenuSelection = {
  dalId: string | null;
  sabjiId: string | null;
};

export type DailyMenuSelectionWriteResult = {
  success: boolean;
  schemaAvailable: boolean;
  message?: string;
};

const SELECTION_SCHEMA_UNAVAILABLE =
  'daily_menu_selections is unavailable — apply migration 00020_add_recipes_and_daily_menu_selections.sql and reload the schema.';

const isMissingSelectionSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  if (['PGRST204', 'PGRST205', '42P01', '42703'].includes(e.code || '')) return true;
  return (
    text.includes('does not exist') ||
    text.includes('could not find the table') ||
    text.includes('could not find the column') ||
    text.includes('schema cache')
  );
};

export async function getDailyMenuSelection(dateKey: string): Promise<DailyMenuSelection> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_menu_selections')
    .select('dal_recipe_id, sabji_recipe_id')
    .eq('date_key', dateKey)
    .maybeSingle();

  if (error) {
    console.warn('[DailyMenu] Selection unavailable — using an empty selection:', error.message);
    return { dalId: null, sabjiId: null };
  }

  const row = data as { dal_recipe_id: string | null; sabji_recipe_id: string | null } | null;
  return { dalId: row?.dal_recipe_id ?? null, sabjiId: row?.sabji_recipe_id ?? null };
}

export async function setDailyMenuSelection(
  dateKey: string,
  dalId?: string | null,
  sabjiId?: string | null
): Promise<DailyMenuSelectionWriteResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('daily_menu_selections').upsert(
    {
      date_key: dateKey,
      dal_recipe_id: dalId || null,
      sabji_recipe_id: sabjiId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'date_key' }
  );

  if (error) {
    if (isMissingSelectionSchemaError(error)) {
      console.warn('[DailyMenu] Selection NOT persisted — table/schema missing:', error.message);
      return { success: false, schemaAvailable: false, message: SELECTION_SCHEMA_UNAVAILABLE };
    }
    console.error('[DailyMenu] Failed to save the selection:', error);
    return { success: false, schemaAvailable: true, message: error.message };
  }

  revalidatePath('/prep');
  return { success: true, schemaAvailable: true };
}

// ── Daily "Today Only" meal-config overrides ────────────────────────────────────
export type DailyOverrideRow = {
  customer_id: string;
  override_date: string;
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  pronthi_count: number | null;
  rice_count: string | null;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  is_custom_curry: boolean | null;
  curry_config: string | null;
  is_skipped: boolean | null;
};

const DAILY_OVERRIDE_COLUMNS = [
  'customer_id',
  'override_date',
  'meal_type',
  'portion_size',
  'roti_count',
  'pronthi_count',
  'rice_count',
  'dietary_notes',
  'delivery_instructions',
  'is_custom_curry',
  'curry_config',
  'is_skipped',
] as const;

const LEGACY_DAILY_OVERRIDE_COLUMNS = DAILY_OVERRIDE_COLUMNS.filter(
  column => column !== 'is_skipped'
);

export type DailyOverrideLoadResult = {
  rows: DailyOverrideRow[];
  schemaAvailable: boolean;
  message?: string;
};

export type DailyOverrideWriteResult = {
  persisted: boolean;
  schemaAvailable: boolean;
  message?: string;
};

const isMissingOverrideSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  if (
    e.code === 'PGRST204' ||
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    e.code === '42703'
  ) {
    return (
      text.includes('customer_daily_overrides') ||
      text.includes('does not exist') ||
      text.includes('could not find') ||
      text.includes('undefined_column')
    );
  }
  return (
    typeof e.message === 'string' &&
    (e.message.toLowerCase().includes('does not exist') ||
      e.message.toLowerCase().includes('could not find the table') ||
      e.message.toLowerCase().includes('could not find the column')) &&
    text.includes('customer_daily_overrides')
  );
};

const formatSchemaUnavailableMessage = (error: unknown): string => {
  const e = error as { message?: string; hint?: string };
  const hint = e?.hint && e.hint.trim() !== '' ? ` (${e.hint})` : '';
  return e?.message ? `${e.message}${hint}` : 'customer_daily_overrides is not available.';
};

export async function getDailyOverrides(dateKey: string): Promise<DailyOverrideLoadResult> {
  const supabase = await createClient();
  const query = (columns: readonly string[] = DAILY_OVERRIDE_COLUMNS) =>
    supabase
      .from('customer_daily_overrides')
      .select(columns.join(','))
      .eq('override_date', dateKey);

  let result = await query();

  let usedLegacyColumns = false;
  if (
    result.error &&
    isMissingOverrideSchemaError(result.error) &&
    String(result.error.message || '').toLowerCase().includes('is_skipped')
  ) {
    result = await query(LEGACY_DAILY_OVERRIDE_COLUMNS);
    usedLegacyColumns = true;
  }

  if (result.error && isMissingOverrideSchemaError(result.error)) {
    const { error: reloadError } = await supabase.rpc('notify_pgrst_reload');
    if (!reloadError) {
      await new Promise(resolve => setTimeout(resolve, 400));
      result = await query(
        usedLegacyColumns ? LEGACY_DAILY_OVERRIDE_COLUMNS : DAILY_OVERRIDE_COLUMNS
      );
    }
  }

  if (result.error) {
    if (isMissingOverrideSchemaError(result.error)) {
      console.warn(
        '[DailyOverride] customer_daily_overrides unavailable — falling back to local-only overrides:',
        result.error.message
      );
      return {
        rows: [],
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(result.error),
      };
    }
    console.error('[DailyOverride] Failed to fetch overrides:', result.error);
    return { rows: [], schemaAvailable: true };
  }

  const rows = ((result.data || []) as unknown as Partial<DailyOverrideRow>[]).map(row => ({
    ...row,
    is_skipped: row.is_skipped === true,
  })) as DailyOverrideRow[];

  return { rows, schemaAvailable: true };
}

// ── Shared Audit Trail Summary Formatter ────────────────────────────────────
function buildMealOverrideSummary(config: {
  portion_size?: string | null;
  meal_type?: string | null;
  delivery_instructions?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  dietary_notes?: string | null;
}): string {
  const parts: string[] = [];
  if (config.portion_size) parts.push(`${config.portion_size} portion`);
  if (config.meal_type) parts.push(config.meal_type);
  if (config.delivery_instructions) {
    const cleanCurry = config.delivery_instructions.replace(/\[NOTE:.*?\]/g, '').trim();
    if (cleanCurry) parts.push(cleanCurry);
  }
  if (typeof config.roti_count === 'number') parts.push(`${config.roti_count} Roti`);
  if (typeof config.pronthi_count === 'number' && config.pronthi_count > 0) parts.push(`${config.pronthi_count} Pronthi`);
  if (config.rice_count && config.rice_count !== 'None' && config.rice_count !== '—') parts.push(`Rice ${config.rice_count}`);
  if (config.dietary_notes) parts.push(`Note: "${config.dietary_notes}"`);

  return parts.length > 0 ? parts.join(' · ') : 'Meal preferences updated';
}

// Upserts the full meal-config snapshot for one customer + date ("Today Only")
export async function upsertDailyOverride(
  input: DailyOverrideRow
): Promise<DailyOverrideWriteResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_daily_overrides')
    .upsert(
      {
        customer_id: input.customer_id,
        override_date: input.override_date,
        meal_type: input.meal_type,
        portion_size: input.portion_size,
        roti_count: input.roti_count,
        pronthi_count: input.pronthi_count,
        rice_count: input.rice_count,
        dietary_notes: input.dietary_notes,
        delivery_instructions: input.delivery_instructions,
        is_custom_curry: input.is_custom_curry,
        curry_config: input.curry_config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,override_date' }
    );

  if (error) {
    if (isMissingOverrideSchemaError(error)) {
      console.warn(
        '[DailyOverride] Override NOT persisted — keeping it local-only (table/schema missing):',
        error.message
      );
      return {
        persisted: false,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(error),
      };
    }
    console.error('[DailyOverride] Failed to save override:', error);
    return { persisted: false, schemaAvailable: true, message: error.message };
  }

  // Auto-log to Customer Audit Trail (shows on the History tab)
  try {
    const summaryDetails = buildMealOverrideSummary(input);
    await supabase.from('customer_activity_logs').insert({
      customer_id: input.customer_id,
      action_type: 'OVERRIDE',
      summary: `Today (${input.override_date}) override: ${summaryDetails}`,
      changed_fields: {
        scope: 'today',
        date: input.override_date,
        portion_size: input.portion_size,
        meal_type: input.meal_type,
        roti_count: input.roti_count,
        pronthi_count: input.pronthi_count,
        rice_count: input.rice_count,
        delivery_instructions: input.delivery_instructions,
        dietary_notes: input.dietary_notes,
      },
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[DailyOverride] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { persisted: true, schemaAvailable: true };
}

export async function deleteDailyOverride(
  customerId: string,
  dateKey: string
): Promise<DailyOverrideWriteResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_daily_overrides')
    .delete()
    .eq('customer_id', customerId)
    .eq('override_date', dateKey);

  if (error) {
    if (isMissingOverrideSchemaError(error)) {
      console.warn(
        '[DailyOverride] Override delete skipped — table/schema missing:',
        error.message
      );
      return { persisted: false, schemaAvailable: false, message: error.message };
    }
    console.error('[DailyOverride] Failed to delete override:', error);
    return { persisted: false, schemaAvailable: true, message: error.message };
  }

  // Auto-log to Customer Audit Trail
  try {
    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: `Reset meal override to master profile for ${dateKey}`,
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[DailyOverride] Log error:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { persisted: true, schemaAvailable: true };
}

// ── Single-day meal skip ─────────────────────────────────────────────────────
export type ToggleDailySkipResult = {
  success: boolean;
  isSkipped: boolean;
  schemaAvailable: boolean;
  message?: string;
};

const isDeliveryWeekday = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

const shiftDeliveryDays = (dateKey: string, delta: number): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime()) || delta === 0) return dateKey;
  const step = delta > 0 ? 1 : -1;
  let remaining = Math.abs(delta);
  while (remaining > 0) {
    date.setDate(date.getDate() + step);
    if (isDeliveryWeekday(date)) remaining -= 1;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const shiftCustomerCycleEnd = async (customerId: string, delta: number): Promise<void> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, cycle_end_date')
    .eq('id', customerId)
    .maybeSingle();

  if (error) {
    console.warn(
      '[DailySkip] cycle_end_date unavailable — billing cycle not adjusted:',
      error.message
    );
    return;
  }

  const cycleEnd = (data as { cycle_end_date?: string | null } | null)?.cycle_end_date;
  if (!cycleEnd) return;

  const next = shiftDeliveryDays(cycleEnd, delta);
  if (next === cycleEnd) return;

  const { error: updateError } = await supabase
    .from('customers')
    .update({ cycle_end_date: next })
    .eq('id', customerId);

  if (updateError) {
    console.warn('[DailySkip] Failed to adjust cycle_end_date:', updateError.message);
  }
};

export async function toggleDailySkip({
  customerId,
  date,
  skipState,
}: {
  customerId: string;
  date: string;
  skipState: boolean;
}): Promise<ToggleDailySkipResult> {
  const supabase = await createClient();

  if (skipState === false) {
    const { data, error } = await supabase
      .from('customer_daily_overrides')
      .select(DAILY_OVERRIDE_COLUMNS.join(','))
      .eq('customer_id', customerId)
      .eq('override_date', date)
      .maybeSingle();

    if (error) {
      if (isMissingOverrideSchemaError(error)) {
        console.warn(
          '[DailySkip] Restore NOT persisted — customer_daily_overrides / is_skipped missing:',
          error.message
        );
        return {
          success: false,
          isSkipped: true,
          schemaAvailable: false,
          message: formatSchemaUnavailableMessage(error),
        };
      }
      console.error('[DailySkip] Failed to read override before restore:', error);
      return {
        success: false,
        isSkipped: true,
        schemaAvailable: true,
        message: error.message,
      };
    }

    const existing = (data ?? null) as Partial<DailyOverrideRow> | null;
    const wasSkipped = existing?.is_skipped === true;

    const { error: deleteError } = await supabase
      .from('customer_daily_overrides')
      .delete()
      .match({ customer_id: customerId, override_date: date });

    if (deleteError) {
      if (isMissingOverrideSchemaError(deleteError)) {
        return {
          success: false,
          isSkipped: true,
          schemaAvailable: false,
          message: formatSchemaUnavailableMessage(deleteError),
        };
      }
      console.error('[DailySkip] Failed to restore the skipped day:', deleteError);
      return {
        success: false,
        isSkipped: true,
        schemaAvailable: true,
        message: deleteError.message,
      };
    }

    if (wasSkipped) {
      await shiftCustomerCycleEnd(customerId, -1);
    }

    // Auto-log un-skip to Customer Audit Trail
    try {
      await supabase.from('customer_activity_logs').insert({
        customer_id: customerId,
        action_type: 'OVERRIDE',
        summary: `Restored delivery for ${date}${wasSkipped ? ' · Cycle adjusted -1d' : ''}`,
        performed_by: 'Kitchen Prep',
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.warn('[DailySkip] Could not record activity log:', logErr);
    }

    revalidatePath('/prep');
    revalidatePath('/admin/customers');
    return { success: true, isSkipped: false, schemaAvailable: true };
  }

  const { error } = await supabase
    .from('customer_daily_overrides')
    .upsert(
      {
        customer_id: customerId,
        override_date: date,
        is_skipped: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,override_date' }
    );

  if (error) {
    if (isMissingOverrideSchemaError(error)) {
      console.warn(
        '[DailySkip] Skip NOT persisted — customer_daily_overrides / is_skipped missing:',
        error.message
      );
      return {
        success: false,
        isSkipped: true,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(error),
      };
    }
    console.error('[DailySkip] Failed to toggle skip:', error);
    return {
      success: false,
      isSkipped: true,
      schemaAvailable: true,
      message: error.message,
    };
  }

  await shiftCustomerCycleEnd(customerId, 1);

  // Auto-log skip to Customer Audit Trail
  try {
    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: `Delivery skipped for ${date} · Cycle extended +1d`,
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[DailySkip] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { success: true, isSkipped: true, schemaAvailable: true };
}

export type ClearDailyOverrideResult = {
  success: boolean;
  schemaAvailable: boolean;
  message?: string;
};

export async function clearDailyOverride({
  customerId,
  date,
}: {
  customerId: string;
  date: string;
}): Promise<ClearDailyOverrideResult> {
  const supabase = await createClient();

  const { data, error: readError } = await supabase
    .from('customer_daily_overrides')
    .select(DAILY_OVERRIDE_COLUMNS.join(','))
    .eq('customer_id', customerId)
    .eq('override_date', date)
    .maybeSingle();

  if (readError) {
    if (isMissingOverrideSchemaError(readError)) {
      console.warn(
        '[DailyOverride] Reset NOT persisted — customer_daily_overrides / is_skipped missing:',
        readError.message
      );
      return {
        success: false,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(readError),
      };
    }
    console.error('[DailyOverride] Failed to read override before reset:', readError);
    return { success: false, schemaAvailable: true, message: readError.message };
  }

  const existing = (data ?? null) as Partial<DailyOverrideRow> | null;
  const wasSkipped = existing?.is_skipped === true;

  const { error } = await supabase
    .from('customer_daily_overrides')
    .delete()
    .eq('customer_id', customerId)
    .eq('override_date', date);

  if (error) {
    if (isMissingOverrideSchemaError(error)) {
      console.warn(
        '[DailyOverride] Reset delete skipped — table/schema missing:',
        error.message
      );
      return {
        success: false,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(error),
      };
    }
    console.error('[DailyOverride] Failed to reset override:', error);
    return { success: false, schemaAvailable: true, message: error.message };
  }

  if (wasSkipped) {
    await shiftCustomerCycleEnd(customerId, -1);
  }

  // Auto-log to Customer Audit Trail
  try {
    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: `Reset meal override to master profile for ${date}${wasSkipped ? ' (skip cancelled, cycle adjusted -1d)' : ''}`,
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[clearDailyOverride] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { success: true, schemaAvailable: true };
}

export async function checkDailyOverrideTable(): Promise<{
  exists: boolean;
  message?: string;
}> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_daily_overrides')
    .select('id')
    .limit(1);

  if (!error) return { exists: true };

  return {
    exists: false,
    message: isMissingOverrideSchemaError(error)
      ? formatSchemaUnavailableMessage(error)
      : error.message,
  };
}

export async function reloadSchemaCache(): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('notify_pgrst_reload');

  if (error) {
    console.error('[DailyOverride] Failed to reload schema cache:', error);
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

// ── Multi-day vacation pause ─────────────────────────────────────────────────
export type VacationPauseResult = {
  success: boolean;
  skippedDays: number;
  schemaAvailable: boolean;
  message?: string;
};

const DEFAULT_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const DAY_NAMES_BY_INDEX = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const formatLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseLocalDateKey = (dateKey: string): Date | null => {
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const deliveryDaysFromSchedule = (schedule: string[] | string): string[] => {
  const raw = Array.isArray(schedule) ? schedule.join(', ') : String(schedule ?? '');
  const expanded = raw.replace(/\b([A-Za-z]{3,9})\s*[-–—]\s*([A-Za-z]{3,9})\b/g, '$1 to $2');
  const days = parseActiveScheduleDays(expanded);
  return days.length > 0 ? days : DEFAULT_DELIVERY_DAYS;
};

const calculateDeliveryDates = (
  startDate: string,
  resumeDate: string,
  schedule: string[] | string
): string[] => {
  const start = parseLocalDateKey(startDate);
  const resume = parseLocalDateKey(resumeDate);
  if (!start || !resume || start >= resume) return [];

  const allowed = new Set(deliveryDaysFromSchedule(schedule));
  const dates: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < resume) {
    if (allowed.has(DAY_NAMES_BY_INDEX[cursor.getDay()])) {
      dates.push(formatLocalDateKey(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export async function setCustomerVacationPause({
  customerId,
  startDate,
  resumeDate,
}: {
  customerId: string;
  startDate: string;
  resumeDate: string;
}): Promise<VacationPauseResult> {
  const supabase = await createClient();

  if (!parseLocalDateKey(startDate) || !parseLocalDateKey(resumeDate) || startDate >= resumeDate) {
    return {
      success: false,
      skippedDays: 0,
      schemaAvailable: true,
      message: 'Pick a resume delivery date after the pause start date.',
    };
  }

  const { data: customerRow, error: readError } = await supabase
    .from('customers')
    .select('id, delivery_schedule')
    .eq('id', customerId)
    .maybeSingle();

  if (readError) {
    console.error('[VacationPause] Failed to read the customer schedule:', readError);
    return { success: false, skippedDays: 0, schemaAvailable: true, message: readError.message };
  }

  const missedDates = calculateDeliveryDates(
    startDate,
    resumeDate,
    (customerRow as { delivery_schedule?: string | null } | null)?.delivery_schedule || ''
  );

  if (missedDates.length > 0) {
    const { error: upsertError } = await supabase
      .from('customer_daily_overrides')
      .upsert(
        missedDates.map(date => ({
          customer_id: customerId,
          override_date: date,
          is_skipped: true,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'customer_id,override_date' }
      );

    if (upsertError) {
      if (isMissingOverrideSchemaError(upsertError)) {
        console.warn(
          '[VacationPause] Pause NOT persisted — customer_daily_overrides / is_skipped missing:',
          upsertError.message
        );
        return {
          success: false,
          skippedDays: 0,
          schemaAvailable: false,
          message: formatSchemaUnavailableMessage(upsertError),
        };
      }
      console.error('[VacationPause] Failed to mark the skipped days:', upsertError);
      return { success: false, skippedDays: 0, schemaAvailable: true, message: upsertError.message };
    }
  }

  const { error: updateError } = await supabase
    .from('customers')
    .update({ pause_start_date: startDate, pause_end_date: resumeDate })
    .eq('id', customerId);

  if (updateError) {
    console.error('[VacationPause] Failed to record the pause window:', updateError);
    return {
      success: false,
      skippedDays: missedDates.length,
      schemaAvailable: true,
      message: updateError.message,
    };
  }

  if (missedDates.length > 0) {
    await shiftCustomerCycleEnd(customerId, missedDates.length);
  }

  // Auto-log to Customer Audit Trail
  try {
    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: `Vacation pause scheduled: ${startDate} to ${resumeDate} (${missedDates.length} delivery days skipped) · Cycle extended +${missedDates.length}d`,
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[VacationPause] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { success: true, skippedDays: missedDates.length, schemaAvailable: true };
}

export async function cancelVacationPause({
  customerId,
}: {
  customerId: string;
}): Promise<VacationPauseResult> {
  const supabase = await createClient();

  const { data: customerRow, error: readError } = await supabase
    .from('customers')
    .select('id, delivery_schedule, pause_start_date, pause_end_date')
    .eq('id', customerId)
    .maybeSingle();

  if (readError) {
    console.error('[VacationPause] Failed to read the pause window:', readError);
    return { success: false, skippedDays: 0, schemaAvailable: true, message: readError.message };
  }

  const row = (customerRow ?? null) as {
    delivery_schedule?: string | null;
    pause_start_date?: string | null;
    pause_end_date?: string | null;
  } | null;

  const pauseStart = row?.pause_start_date ?? null;
  const pauseEnd = row?.pause_end_date ?? null;

  const missedDates =
    pauseStart && pauseEnd
      ? calculateDeliveryDates(pauseStart, pauseEnd, row?.delivery_schedule || '')
      : [];

  if (missedDates.length > 0) {
    const { error: deleteError } = await supabase
      .from('customer_daily_overrides')
      .delete()
      .eq('customer_id', customerId)
      .eq('is_skipped', true)
      .in('override_date', missedDates);

    if (deleteError) {
      if (isMissingOverrideSchemaError(deleteError)) {
        console.warn(
          '[VacationPause] Cancel delete skipped — table/schema missing:',
          deleteError.message
        );
        return {
          success: false,
          skippedDays: 0,
          schemaAvailable: false,
          message: formatSchemaUnavailableMessage(deleteError),
        };
      }
      console.error('[VacationPause] Failed to clear the skipped days:', deleteError);
      return { success: false, skippedDays: 0, schemaAvailable: true, message: deleteError.message };
    }
  }

  if (missedDates.length > 0) {
    await shiftCustomerCycleEnd(customerId, -missedDates.length);
  }

  const { error: updateError } = await supabase
    .from('customers')
    .update({ pause_start_date: null, pause_end_date: null })
    .eq('id', customerId);

  if (updateError) {
    console.error('[VacationPause] Failed to clear the pause window:', updateError);
    return {
      success: false,
      skippedDays: missedDates.length,
      schemaAvailable: true,
      message: updateError.message,
    };
  }

  // Auto-log to Customer Audit Trail
  try {
    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: `Vacation pause cancelled · Cycle adjusted -${missedDates.length}d`,
      performed_by: 'Kitchen Prep',
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[VacationPause] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return { success: true, skippedDays: missedDates.length, schemaAvailable: true };
}

// ── Unified date-range override save ─────────────────────────────────────────
export type SaveCustomerOverrideScope = 'today' | 'range' | 'permanent';

export type SaveCustomerOverrideInput = {
  customerId: string;
  scope: SaveCustomerOverrideScope;
  startDate: string;
  endDate: string;
  isSkipped: boolean;
  mealConfig?: MealConfigPayload | null;
};

export type SaveCustomerOverrideResult = {
  success: boolean;
  scope: SaveCustomerOverrideScope;
  affectedDays: number;
  cycleDaysChanged: number;
  schemaAvailable: boolean;
  message?: string;
};

const resolveDeliveryDatesInRange = (
  startDate: string,
  endDate: string,
  schedule: string[] | string
): string[] => {
  const start = parseLocalDateKey(startDate);
  const end = parseLocalDateKey(endDate);
  if (!start || !end || start > end) return [];

  const allowed = new Set(deliveryDaysFromSchedule(schedule));
  const dates: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    if (allowed.has(DAY_NAMES_BY_INDEX[cursor.getDay()])) {
      dates.push(formatLocalDateKey(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export async function saveCustomerOverride(
  input: SaveCustomerOverrideInput
): Promise<SaveCustomerOverrideResult> {
  const { customerId, scope, isSkipped } = input;
  const startDate = input.startDate || input.endDate;
  const endDate = input.endDate || input.startDate;
  const supabase = await createClient();

  // ── Permanent Profile ───────────────────────────────────────────────────────
  if (scope === 'permanent') {
    try {
      const config = input.mealConfig ?? {};
      if (Object.keys(config).length > 0) {
        await updateCustomerMealConfig(customerId, config);
      }
      await deleteDailyOverride(customerId, startDate);

      // Auto-log to Customer Audit Trail
      try {
        await supabase.from('customer_activity_logs').insert({
          customer_id: customerId,
          action_type: 'OVERRIDE',
          summary: `Master profile updated: ${buildMealOverrideSummary(config)}`,
          changed_fields: config,
          performed_by: 'Kitchen Prep',
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('[SaveOverride] Log error:', logErr);
      }
    } catch (err) {
      console.error('[SaveOverride] Permanent profile sync failed:', err);
      return {
        success: false,
        scope,
        affectedDays: 0,
        cycleDaysChanged: 0,
        schemaAvailable: true,
        message:
          err instanceof Error
            ? err.message
            : 'Could not update the master profile. Please try again.',
      };
    }
    revalidatePath('/prep');
    revalidatePath('/admin/customers');
    return { success: true, scope, affectedDays: 0, cycleDaysChanged: 0, schemaAvailable: true };
  }

  // ── Today Only / Date Range ─────────────────────────────────────────────────
  const { data: customerRow, error: readError } = await supabase
    .from('customers')
    .select('id, delivery_schedule')
    .eq('id', customerId)
    .maybeSingle();

  if (readError) {
    console.error('[SaveOverride] Failed to read the customer schedule:', readError);
    return {
      success: false,
      scope,
      affectedDays: 0,
      cycleDaysChanged: 0,
      schemaAvailable: true,
      message: readError.message,
    };
  }

  const schedule =
    (customerRow as { delivery_schedule?: string | null } | null)?.delivery_schedule || '';
  const dates = resolveDeliveryDatesInRange(startDate, endDate, schedule);

  if (dates.length === 0) {
    return { success: true, scope, affectedDays: 0, cycleDaysChanged: 0, schemaAvailable: true };
  }

  const { data: existingData, error: existingError } = await supabase
    .from('customer_daily_overrides')
    .select('override_date, is_skipped')
    .eq('customer_id', customerId)
    .in('override_date', dates);

  if (existingError) {
    if (isMissingOverrideSchemaError(existingError)) {
      console.warn(
        '[SaveOverride] Override NOT persisted — customer_daily_overrides / is_skipped missing:',
        existingError.message
      );
      return {
        success: false,
        scope,
        affectedDays: 0,
        cycleDaysChanged: 0,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(existingError),
      };
    }
    console.error('[SaveOverride] Failed to read the existing overrides:', existingError);
    return {
      success: false,
      scope,
      affectedDays: dates.length,
      cycleDaysChanged: 0,
      schemaAvailable: true,
      message: existingError.message,
    };
  }

  const previouslySkipped = new Set(
    ((existingData || []) as { override_date: string; is_skipped: boolean | null }[])
      .filter(row => row.is_skipped === true)
      .map(row => row.override_date)
  );

  const now = new Date().toISOString();

  // ── Skip the window ─────────────────────────────────────────────────────────
  if (isSkipped) {
    const { error } = await supabase.from('customer_daily_overrides').upsert(
      dates.map(date => ({
        customer_id: customerId,
        override_date: date,
        is_skipped: true,
        updated_at: now,
      })),
      { onConflict: 'customer_id,override_date' }
    );

    if (error) {
      if (isMissingOverrideSchemaError(error)) {
        console.warn(
          '[SaveOverride] Skip NOT persisted — customer_daily_overrides / is_skipped missing:',
          error.message
        );
        return {
          success: false,
          scope,
          affectedDays: 0,
          cycleDaysChanged: 0,
          schemaAvailable: false,
          message: formatSchemaUnavailableMessage(error),
        };
      }
      console.error('[SaveOverride] Failed to persist the skipped days:', error);
      return {
        success: false,
        scope,
        affectedDays: dates.length,
        cycleDaysChanged: 0,
        schemaAvailable: true,
        message: error.message,
      };
    }

    const newlySkipped = dates.filter(date => !previouslySkipped.has(date));
    if (newlySkipped.length > 0) {
      await shiftCustomerCycleEnd(customerId, newlySkipped.length);
    }

    // Auto-log to Customer Audit Trail
    try {
      const scopeLabel = scope === 'today' ? `for ${startDate}` : `(${startDate} to ${endDate}, ${dates.length} days)`;
      await supabase.from('customer_activity_logs').insert({
        customer_id: customerId,
        action_type: 'OVERRIDE',
        summary: `Delivery skipped ${scopeLabel}${newlySkipped.length > 0 ? ` · Cycle extended +${newlySkipped.length}d` : ''}`,
        changed_fields: { scope, dates, newly_skipped: newlySkipped.length },
        performed_by: 'Kitchen Prep',
        created_at: now,
      });
    } catch (logErr) {
      console.warn('[SaveOverride] Log error:', logErr);
    }

    revalidatePath('/prep');
    revalidatePath('/admin/customers');
    return {
      success: true,
      scope,
      affectedDays: dates.length,
      cycleDaysChanged: newlySkipped.length,
      schemaAvailable: true,
    };
  }

  // ── Custom meal / notes ─────────────────────────────────────────────────────
  const config = input.mealConfig ?? {};
  const snapshot = {
    meal_type: config.meal_type ?? null,
    portion_size: config.portion_size ?? null,
    roti_count: config.roti_count ?? null,
    pronthi_count: config.pronthi_count ?? null,
    rice_count: config.rice_count ?? null,
    dietary_notes: config.dietary_notes ?? null,
    delivery_instructions: config.delivery_instructions ?? null,
    is_custom_curry: config.is_custom_curry ?? null,
    curry_config: config.curry_config ?? null,
    is_skipped: false,
  };

  const { error } = await supabase.from('customer_daily_overrides').upsert(
    dates.map(date => ({
      customer_id: customerId,
      override_date: date,
      ...snapshot,
      updated_at: now,
    })),
    { onConflict: 'customer_id,override_date' }
  );

  if (error) {
    if (isMissingOverrideSchemaError(error)) {
      console.warn(
        '[SaveOverride] Override NOT persisted — customer_daily_overrides / is_skipped missing:',
        error.message
      );
      return {
        success: false,
        scope,
        affectedDays: 0,
        cycleDaysChanged: 0,
        schemaAvailable: false,
        message: formatSchemaUnavailableMessage(error),
      };
    }
    console.error('[SaveOverride] Failed to persist the meal override:', error);
    return {
      success: false,
      scope,
      affectedDays: dates.length,
      cycleDaysChanged: 0,
      schemaAvailable: true,
      message: error.message,
    };
  }

  const restored = dates.filter(date => previouslySkipped.has(date));
  if (restored.length > 0) {
    await shiftCustomerCycleEnd(customerId, -restored.length);
  }

  // Auto-log to Customer Audit Trail
  try {
    const summaryDetails = buildMealOverrideSummary(config);
    const summaryText =
      scope === 'today'
        ? `Today (${startDate}) override: ${summaryDetails}`
        : `Date range override (${startDate} to ${endDate}): ${summaryDetails}`;

    await supabase.from('customer_activity_logs').insert({
      customer_id: customerId,
      action_type: 'OVERRIDE',
      summary: summaryText,
      changed_fields: {
        scope,
        start_date: startDate,
        end_date: endDate,
        ...config,
      },
      performed_by: 'Kitchen Prep',
      created_at: now,
    });
  } catch (logErr) {
    console.warn('[SaveOverride] Could not record activity log:', logErr);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  return {
    success: true,
    scope,
    affectedDays: dates.length,
    cycleDaysChanged: -restored.length,
    schemaAvailable: true,
  };
}

// ── Two-tier subscription renewal (Active Cycle vs Lifetime History) ──────────
export type RenewalMode = 'cycle_reset' | 'mid_cycle_topup';

export type RenewCustomerSubscriptionInput = {
  customerId: string;
  creditsToAdd: number;
  planTier?: 'trial' | 'weekly' | 'monthly';
  startDate?: string | null;
};

export type RenewCustomerSubscriptionResult = {
  success: boolean;
  message?: string;
  mode?: RenewalMode;
  startDate?: string;
  credits?: number;
  usedCredits?: number;
  cycleEndDate?: string | null;
  planTier?: 'trial' | 'weekly' | 'monthly';
  lifetimeTracked?: boolean;
  migrationRecommended?: boolean;
};

const OPTIONAL_RENEWAL_COLUMNS: string[][] = [
  ['lifetime_deliveries', 'renewal_count'],
  ['payment_status'],
  ['scheduled_cancel_date', 'scheduled_status'],
  ['cancelled_at', 'cancellation_reason'],
  ['used_credits', 'skipped_days_count'],
  ['cycle_end_date'],
];

const isCustomerColumnMissing = (error: unknown, names: string[]): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  if (e.code !== 'PGRST204' && e.code !== '42703') return false;
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  return names.some(name => text.includes(name.toLowerCase()));
};

type CustomerWriteOutcome = {
  error: unknown | null;
  stripped: string[];
};

const writeCustomerPayload = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
  payload: Record<string, unknown>
): Promise<CustomerWriteOutcome> => {
  const current = { ...payload };
  const stripped: string[] = [];

  for (let attempt = 0; attempt <= OPTIONAL_RENEWAL_COLUMNS.length; attempt++) {
    const { error } = await supabase.from('customers').update(current).eq('id', customerId);
    if (!error) return { error: null, stripped };

    const missingGroup = OPTIONAL_RENEWAL_COLUMNS.find(group =>
      isCustomerColumnMissing(error, group)
    );
    if (!missingGroup) return { error, stripped };

    missingGroup.forEach(column => delete current[column]);
    stripped.push(...missingGroup);
  }

  return { error: new Error('Renewal could not be persisted.'), stripped };
};

const fetchClosureDates = async (
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Set<string>> => {
  try {
    const { data, error } = await supabase.from('kitchen_closures').select('closure_date');
    if (error || !data) return new Set();
    return new Set(
      data
        .map(row => normalizeDateKey((row as { closure_date?: string | null }).closure_date))
        .filter((key): key is string => Boolean(key))
    );
  } catch {
    return new Set();
  }
};

const fetchCustomerSkipDates = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string
): Promise<Set<string>> => {
  try {
    const { data, error } = await supabase
      .from('customer_daily_overrides')
      .select('override_date')
      .eq('customer_id', customerId)
      .eq('is_skipped', true);
    if (error || !data) return new Set();
    return new Set(
      data
        .map(row => normalizeDateKey((row as { override_date?: string | null }).override_date))
        .filter((key): key is string => Boolean(key))
    );
  } catch {
    return new Set();
  }
};

const readLifetimeCounters = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string
): Promise<{ lifetime_deliveries: number; renewal_count: number } | null> => {
  const { data, error } = await supabase
    .from('customers')
    .select('lifetime_deliveries, renewal_count')
    .eq('id', customerId)
    .maybeSingle<{ lifetime_deliveries: number | null; renewal_count: number | null }>();
  if (error || !data) return null;
  return {
    lifetime_deliveries: Math.max(0, Math.trunc(Number(data.lifetime_deliveries) || 0)),
    renewal_count: Math.max(0, Math.trunc(Number(data.renewal_count) || 0)),
  };
};

export async function renewCustomerSubscription({
  customerId,
  creditsToAdd,
  planTier,
  startDate,
}: RenewCustomerSubscriptionInput): Promise<RenewCustomerSubscriptionResult> {
  try {
    const credits = Math.trunc(Number(creditsToAdd));
    if (!customerId) return { success: false, message: 'Missing customer id.' };
    if (!Number.isFinite(credits) || credits < 1) {
      return { success: false, message: 'Add at least 1 meal credit to renew.' };
    }

    const supabase = await createClient();

    type CustomerRow = {
      id: string;
      total_tiffin_credits?: number | null;
      used_credits?: number | null;
      plan_tier?: string | null;
      start_date?: string | null;
      cycle_end_date?: string | null;
      delivery_schedule?: string | null;
      subscription_status?: string | null;
    };

    let usedColumnAvailable = true;
    let { data: customer, error: fetchErr } = await supabase
      .from('customers')
      .select(
        'id, total_tiffin_credits, used_credits, plan_tier, start_date, cycle_end_date, delivery_schedule, subscription_status'
      )
      .eq('id', customerId)
      .maybeSingle<CustomerRow>();

    if (fetchErr) {
      usedColumnAvailable = false;
      const fallback = await supabase
        .from('customers')
        .select('id, total_tiffin_credits, plan_tier')
        .eq('id', customerId)
        .maybeSingle<CustomerRow>();
      customer = fallback.data;
      fetchErr = fallback.error;
    }

    if (fetchErr) return { success: false, message: fetchErr.message };
    if (!customer) return { success: false, message: 'Customer not found.' };

    const requestedStart = normalizeDateKey(startDate) || toLocalDateKey(new Date());
    const totalCredits = Math.max(0, Math.trunc(Number(customer.total_tiffin_credits) || 0));
    const used = usedColumnAvailable
      ? Math.max(0, Math.trunc(Number(customer.used_credits) || 0))
      : 0;
    const remaining = usedColumnAvailable ? totalCredits - used : null;

    const existingStart = normalizeDateKey(customer.start_date);
    const existingEnd = normalizeDateKey(customer.cycle_end_date);
    const subscriptionStatus = (customer.subscription_status || '').toLowerCase();

    const deliveryDays = resolveDeliveryDayNumbers(customer.delivery_schedule);
    const closureDates = await fetchClosureDates(supabase);
    const customerSkips = await fetchCustomerSkipDates(supabase, customerId);

    const effectiveEnd =
      existingEnd ||
      (existingStart
        ? computeCycleEndDate({
            startDate: existingStart,
            totalMeals: totalCredits,
            deliveryDays,
            closureDates,
            customerSkips,
          })
        : null);

    const cycleIsOver = effectiveEnd ? requestedStart > effectiveEnd : false;
    const isRenewalPending =
      subscriptionStatus === 'expired' ||
      subscriptionStatus === 'cancelled' ||
      !existingStart ||
      cycleIsOver ||
      (remaining !== null && remaining <= 0);

    const mode: RenewalMode = isRenewalPending ? 'cycle_reset' : 'mid_cycle_topup';

    let nextStartDate: string;
    let nextCredits: number;
    let nextUsed: number;
    let nextEnd: string | null;

    if (mode === 'cycle_reset') {
      nextStartDate = requestedStart;
      nextCredits = credits;
      nextUsed = 0;
      nextEnd = computeCycleEndDate({
        startDate: nextStartDate,
        totalMeals: nextCredits,
        deliveryDays,
        closureDates,
        customerSkips,
      });
    } else {
      nextStartDate = existingStart as string;
      nextCredits = totalCredits + credits;
      nextUsed = used;
      nextEnd =
        shiftCycleEndByDeliveryDays(
          effectiveEnd || nextStartDate,
          credits,
          deliveryDays,
          closureDates
        ) ||
        computeCycleEndDate({
          startDate: nextStartDate,
          totalMeals: nextCredits,
          deliveryDays,
          closureDates,
          customerSkips,
        });
    }

    const nextTier = planTier || resolvePlanTierForCredits(nextCredits);
    const lifetime = await readLifetimeCounters(supabase, customerId);

    const payload: Record<string, unknown> = {
      start_date: nextStartDate,
      total_tiffin_credits: nextCredits,
      plan_tier: nextTier,
      subscription_status: 'active',
      payment_status: 'paid',
      scheduled_cancel_date: null,
      scheduled_status: null,
    };

    if (usedColumnAvailable) {
      payload.used_credits = nextUsed;
      payload.skipped_days_count = 0;
    }
    if (nextEnd) payload.cycle_end_date = nextEnd;
    if (mode === 'cycle_reset' && subscriptionStatus === 'cancelled') {
      payload.cancelled_at = null;
      payload.cancellation_reason = null;
    }

    if (lifetime) {
      payload.renewal_count = lifetime.renewal_count + 1;
      payload.lifetime_deliveries =
        lifetime.lifetime_deliveries + (mode === 'cycle_reset' ? totalCredits : 0);
    }

    const write = await writeCustomerPayload(supabase, customerId, payload);
    if (write.error) {
      console.error('[renewCustomerSubscription] update failed:', write.error);
      return {
        success: false,
        message:
          write.error instanceof Error
            ? write.error.message
            : 'Failed to renew the subscription.',
      };
    }

    // Auto-record to Customer Audit Trail (shows on the History tab)
    try {
      const summaryText =
        mode === 'cycle_reset'
          ? `Subscription renewed (+${credits} meals, ${(nextTier || 'plan').toUpperCase()}) — New cycle starts ${nextStartDate}`
          : `Mid-cycle top-up (+${credits} meals) — New balance: ${nextCredits} credits`;

      await supabase.from('customer_activity_logs').insert({
        customer_id: customerId,
        action_type: 'BILLING',
        summary: summaryText,
        changed_fields: {
          mode,
          credits_added: credits,
          total_credits: nextCredits,
          plan_tier: nextTier,
          start_date: nextStartDate,
          cycle_end_date: nextEnd,
        },
        performed_by: 'Kitchen Prep',
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.warn('[renewCustomerSubscription] Could not record activity log:', logErr);
    }

    const lifetimeTracked = lifetime !== null && !write.stripped.includes('lifetime_deliveries');
    if (!lifetimeTracked) {
      console.warn(
        '[renewCustomerSubscription] lifetime history not persisted — run ' +
          'supabase/migrations/00023_add_lifetime_counters.sql to enable lifetime counters.'
      );
    }

    revalidatePath('/prep');
    revalidatePath('/admin/customers');
    revalidatePath('/admin/deliveries');

    return {
      success: true,
      mode,
      startDate: nextStartDate,
      credits: nextCredits,
      usedCredits: nextUsed,
      cycleEndDate: nextEnd,
      planTier: nextTier,
      lifetimeTracked,
      migrationRecommended: !lifetimeTracked,
    };
  } catch (err) {
    console.error('[renewCustomerSubscription] unexpected error:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Failed to extend subscription',
    };
  }
}

export async function endCustomerSubscription(
  customerId: string,
  effectiveEndDate?: string | null
): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();

    const endKey = normalizeDateKey(effectiveEndDate) || toLocalDateKey(new Date());

    const { error } = await supabase
      .from('customers')
      .update({
        cycle_end_date: endKey,
        scheduled_cancel_date: endKey,
        scheduled_status: 'cancelled',
        cancellation_reason: 'Non-renewal archived',
      })
      .eq('id', customerId);

    if (error) throw error;

    // Log the archiving event
    try {
      await supabase.from('customer_activity_logs').insert({
        customer_id: customerId,
        action_type: 'OVERRIDE',
        summary: `Subscription ended and archived (effective ${endKey})`,
        performed_by: 'Kitchen Prep',
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.warn('[endCustomerSubscription] Could not record activity log:', logErr);
    }

    revalidatePath('/prep');
    revalidatePath('/admin/customers');
    revalidatePath('/admin/deliveries');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Could not end subscription.',
    };
  }
}

export type DailyManifestSnapshotRow = {
  id?: string;
  delivery_date: string;
  customer_id: string;
  customer_name: string;
  delivery_address: string;
  is_pickup: boolean;
  meal_type: string;
  portion_size: string;
  roti_count: number;
  pronthi_count: number;
  rice_count: string | null;
  dal_name: string | null;
  sabji_name: string | null;
  chicken_name: string | null;
  sides_summary: string | null;
  special_instructions: string | null;
  is_skipped: boolean;
  created_at?: string;
};

export async function getDailyManifestSnapshot(dateKey: string): Promise<DailyManifestSnapshotRow[]> {
  try {
    const { createClient } = await import('@/utils/supabase/server');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('daily_delivery_manifests')
      .select('*')
      .eq('delivery_date', dateKey)
      .order('customer_name', { ascending: true });

    if (error) throw error;
    return (data as DailyManifestSnapshotRow[]) || [];
  } catch (err) {
    console.error('[Snapshot] Failed to fetch historical manifest:', err);
    return [];
  }
}

export async function saveDailyManifestSnapshot(
  dateKey: string,
  rows: DailyManifestSnapshotRow[]
): Promise<{ success: boolean; message?: string }> {
  try {
    const { createClient } = await import('@/utils/supabase/server');
    const supabase = await createClient();

    if (!rows.length) return { success: true };

    const { error } = await supabase
      .from('daily_delivery_manifests')
      .upsert(rows, { onConflict: 'delivery_date,customer_id' });

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('[Snapshot] Failed to save manifest snapshot:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Failed to save snapshot' };
  }
}