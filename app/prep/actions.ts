'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { parseActiveScheduleDays } from '@/app/utils/customerPickup';
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
// The "Today's Kitchen Menu" section of the Prep dashboard picks one dal and one
// sabji recipe (from public.recipes) for each date. The selection is stored one
// row per `selection_date` in public.daily_menu_selections and feeds the batch
// prep calculator (see PrepDashboardClient).
export type DailyMenuSelection = {
  dalId: string | null;
  sabjiId: string | null;
};

export type DailyMenuSelectionWriteResult = {
  success: boolean;
  // false when the table is missing OR the PostgREST schema cache is stale.
  schemaAvailable: boolean;
  message?: string;
};

const SELECTION_SCHEMA_UNAVAILABLE =
  'daily_menu_selections is unavailable — apply migration 00020_add_recipes_and_daily_menu_selections.sql and reload the schema.';

// Shared classifier for the recipes-catalog tables (recipes / recipe_ingredients /
// daily_menu_selections).
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

// Reads the dal/sabji selection for one date. Degrades to an empty selection when
// the table is unavailable so the Prep dashboard never crashes on an older schema.
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

// Upserts the dal/sabji recipe ids for one date (one row per date_key).
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
// A date-scoped row stores a FULL snapshot of the customer's meal config for one
// calendar date (the "⚡ Today Only" scope of the Prep Quick Meal Edit drawer).
// The prep manifest merges the snapshot over the base customers profile ONLY when
// the selected date matches override_date; every other date keeps using the
// master subscription defaults untouched.
export type DailyOverrideRow = {
  customer_id: string;
  override_date: string; // local YYYY-MM-DD
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  pronthi_count: number | null;
  rice_count: string | null;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  is_custom_curry: boolean | null;
  curry_config: string | null;
  // Date-scoped skip flag (migration 00019). A row may carry ONLY this flag — every
  // meal-config column NULL — when the day is skipped without a meal edit.
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

// Legacy column set for databases that have NOT yet applied migration 00019
// (is_skipped). Selecting the flag-less set keeps the existing "Today Only"
// overrides working instead of degrading the whole feature.
const LEGACY_DAILY_OVERRIDE_COLUMNS = DAILY_OVERRIDE_COLUMNS.filter(
  column => column !== 'is_skipped'
);

// ── Schema-degradation helpers ──────────────────────────────────────────────
// customer_daily_overrides is created by supabase/migrations/00015 (and ensured
// again by 00016_notify_pgrst_reload.sql). Until that migration is applied — or the PostgREST schema
// cache is refreshed (NOTIFY pgrst, 'reload schema') — every query against the
// table fails with a "not found" PostgREST/Postgres error. These helpers
// classify that condition so the Prep dashboard can fall back to an in-session,
// local-only override store instead of crashing.

export type DailyOverrideLoadResult = {
  rows: DailyOverrideRow[];
  // false when the table/columns are missing OR the schema cache is stale.
  schemaAvailable: boolean;
  // When schemaAvailable:false this carries the PostgREST/Postgres error text
  // so the UI can show exactly why persistence is unavailable.
  message?: string;
};

export type DailyOverrideWriteResult = {
  persisted: boolean;
  schemaAvailable: boolean;
  message?: string;
};

// PostgREST emits PGRST205 ("could not find the table in the schema cache") for a
// stale schema cache, PGRST204 on response/schema mismatches, and Postgres
// itself reports 42P01/42703 when the relation/column genuinely does not exist.
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

// Loads every "Today Only" override that applies to a single delivery date.
// When the table (or its PostgREST schema-cache entry) is unavailable the call
// RESOLVES with schemaAvailable:false + an empty row list instead of throwing,
// so the dashboard can keep working in local-only mode.

export async function getDailyOverrides(dateKey: string): Promise<DailyOverrideLoadResult> {
  const supabase = await createClient();
  const query = (columns: readonly string[] = DAILY_OVERRIDE_COLUMNS) =>
    supabase
      .from('customer_daily_overrides')
      .select(columns.join(','))
      .eq('override_date', dateKey);

  let result = await query();

  // is_skipped landed in migration 00019. On a database that has not applied it yet the
  // flag-aware select fails, so retry against the legacy column set (every row then reads
  // is_skipped:false) rather than degrading the whole override feature.
  let usedLegacyColumns = false;
  if (
    result.error &&
    isMissingOverrideSchemaError(result.error) &&
    String(result.error.message || '').toLowerCase().includes('is_skipped')
  ) {
    result = await query(LEGACY_DAILY_OVERRIDE_COLUMNS);
    usedLegacyColumns = true;
  }

  // The table may already exist while PostgREST still holds a STALE schema cache
  // (e.g. it was created moments ago by a migration). Try ONE automatic schema
  // reload (NOTIFY pgrst, 'reload schema') and retry before falling back.
  if (result.error && isMissingOverrideSchemaError(result.error)) {
    const { error: reloadError } = await supabase.rpc('notify_pgrst_reload');
    if (!reloadError) {
      // The schema reload is applied asynchronously by PostgREST.
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

  // Normalize the skip flag so a legacy column set (or a NULL value) always reads false.
  const rows = ((result.data || []) as unknown as Partial<DailyOverrideRow>[]).map(row => ({
    ...row,
    is_skipped: row.is_skipped === true,
  })) as DailyOverrideRow[];

  return { rows, schemaAvailable: true };
}

// Upserts the full meal-config snapshot for one customer + date (replaces any
// existing override so the day always carries exactly what was last saved).
// schemaAvailable:false means the write was NOT persisted and the caller should
// keep its optimistic row as a session-local override.
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

  revalidatePath('/prep');
  return { persisted: true, schemaAvailable: true };
}

// Removes a date-scoped override — used when a customer is saved with the
// "All Future Deliveries (Permanent)" scope so the date reverts to the master
// profile instead of pinning stale single-day values.
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

  revalidatePath('/prep');
  return { persisted: true, schemaAvailable: true };
}

// ── Single-day meal skip ─────────────────────────────────────────────────────
// A skip is stored on the same date-scoped override row as a lone `is_skipped` flag
// (every meal-config column stays NULL), so the prep manifest can drop the customer
// from today's cooking totals / active-delivery count while still rendering the row
// (muted) for the packer. Toggling a skip also walks the customer's billing-cycle end
// by ONE delivery day: +1 on skip, −1 when the meal is restored.

export type ToggleDailySkipResult = {
  success: boolean;
  isSkipped: boolean;
  // false when the table/column is missing OR the PostgREST schema cache is stale.
  schemaAvailable: boolean;
  message?: string;
};

// Weekday = a delivery day under the app's Mon–Fri default schedule.
const isDeliveryWeekday = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

// Shifts a local YYYY-MM-DD date by `delta` DELIVERY days (weekdays only).
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

// Extends (delta +1) or rolls back (delta −1) the customer's active billing cycle end
// by one delivery day. A missing `cycle_end_date` column (migration 00019 not applied)
// or an untracked cycle end is a silent no-op so the skip itself always succeeds.
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

// Skips (or restores) a single delivery day for one customer and extends/rolls back
// their active subscription cycle by one delivery day.
//
// Restoring (skipState === false) is a HARD RESET: the date-scoped override row is
// DELETED outright so the customer falls back cleanly to their master `customers`
// profile. A skip record carries ONLY `is_skipped`, so this can never leave stale
// meal-config columns behind (a bogus 'VEG' / 'RG', a leftover "Today Only" snapshot)
// nor a lingering "⚡ Today" badge.
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

  // ── Undo Skip ───────────────────────────────────────────────────────────────
  if (skipState === false) {
    // Read the row FIRST: it tells us whether the day was actually skipped (so the +1
    // billing-cycle extension is rolled back) and lets us classify a missing-table /
    // stale-schema failure. The DELETE below is unconditional.
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

    // Undo is a HARD RESET of the day: DELETE the override row outright so the customer
    // resolves purely from the master `customers` profile again. A skip record carries
    // ONLY `is_skipped` (every meal-config column NULL), so removing it guarantees zero
    // stale columns — no bogus 'VEG' / 'RG', no leftover meal snapshot, and no lingering
    // "⚡ Today" badge after a restore.
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

    // Only a day that was ACTUALLY skipped carries a +1 cycle extension to roll back.
    if (wasSkipped) {
      await shiftCustomerCycleEnd(customerId, -1);
    }

    revalidatePath('/prep');
    return { success: true, isSkipped: false, schemaAvailable: true };
  }

  // ── Skip ────────────────────────────────────────────────────────────────────
  // Upsert ONLY the skip flag + timestamp, so any meal-config snapshot already saved
  // for the day survives the conflict update untouched.
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

  // Skip extends the paid cycle by one delivery day.
  await shiftCustomerCycleEnd(customerId, 1);

  revalidatePath('/prep');
  return { success: true, isSkipped: true, schemaAvailable: true };
}

// Result shape for the one-click "Reset to Master Profile" control.
export type ClearDailyOverrideResult = {
  success: boolean;
  // false when the table/column is missing OR the PostgREST schema cache is stale.
  schemaAvailable: boolean;
  message?: string;
};

// Deletes a date-scoped override outright, discarding ALL daily changes so the day
// resolves purely from the master `customers` profile again. When the row was
// SKIPPED the +1 billing-cycle extension applied on skip is rolled back so the paid
// cycle stays balanced.
export async function clearDailyOverride({
  customerId,
  date,
}: {
  customerId: string;
  date: string;
}): Promise<ClearDailyOverrideResult> {
  const supabase = await createClient();

  // Read the row first so a skipped day's cycle extension can be rolled back.
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

  // A reset of a SKIPPED day rolls the +1 cycle extension back.
  if (wasSkipped) {
    await shiftCustomerCycleEnd(customerId, -1);
  }

  revalidatePath('/prep');
  return { success: true, schemaAvailable: true };
}

// Cheap existence probe used by the "Reload schema & retry" fallback control.
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

// Refreshes the PostgREST schema cache (NOTIFY pgrst, 'reload schema') after the
// migration has been applied — surfaced as RPC notify_pgrst_reload by migration
// 00016_notify_pgrst_reload.sql so the app never needs raw SQL access.
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
// A vacation pause skips EVERY delivery day in the half-open window
// [startDate, resumeDate) and extends the customer's paid billing cycle by the exact
// number of skipped delivery days. It reuses the single-day skip primitive: one
// `is_skipped` row in customer_daily_overrides per missed date (so the prep manifest
// mutes the row + drops it from the cooking totals) plus `pause_start_date` /
// `pause_end_date` on the customer so the window can be shown and cancelled as a unit.

export type VacationPauseResult = {
  success: boolean;
  // Number of delivery days the window skipped (== the cycle extension applied).
  skippedDays: number;
  // false when customer_daily_overrides (or its PostgREST schema cache) is unavailable.
  schemaAvailable: boolean;
  message?: string;
};

// Mon–Fri fallback used when a customer has no explicit schedule on file — mirrors the
// app's default delivery week (`DEFAULT_DELIVERY_SCHEDULE`).
const DEFAULT_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// getDay() index → full day name.
const DAY_NAMES_BY_INDEX = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Local YYYY-MM-DD key (never UTC-split) for a Date.
const formatLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Parses a local YYYY-MM-DD key into a local-midnight Date (null when invalid).
const parseLocalDateKey = (dateKey: string): Date | null => {
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Normalizes either a raw delivery_schedule string (e.g. 'Mon - Fri' or
// 'Monday to Friday, Saturday', with optional [EXCEPT: ...] notes) or an already-parsed
// day-name array into full day names. Falls back to the Mon–Fri default when nothing
// meaningful parses so a plan-less customer never silently skips zero days.
const deliveryDaysFromSchedule = (schedule: string[] | string): string[] => {
  const raw = Array.isArray(schedule) ? schedule.join(', ') : String(schedule ?? '');
  // 'Mon - Fri' / 'Mon–Fri' hyphen ranges are normalized to the 'X to Y' form the shared
  // parser expands (so a Mon–Fri plan skips Sat/Sun), then parsed into full day names.
  const expanded = raw.replace(/\b([A-Za-z]{3,9})\s*[-–—]\s*([A-Za-z]{3,9})\b/g, '$1 to $2');
  const days = parseActiveScheduleDays(expanded);
  return days.length > 0 ? days : DEFAULT_DELIVERY_DAYS;
};

// Every DELIVERY date strictly inside the half-open window [startDate, resumeDate):
// the pause START day is skipped and the RESUME day is the first served day again.
// Dates whose weekday falls outside the customer's delivery schedule are never
// generated (a Mon–Fri customer accumulates no Sat/Sun skips). Returns ascending
// local YYYY-MM-DD keys. Mirrored client-side for the drawer's live preview.
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

// Schedules a multi-day vacation pause: marks every delivery day in the window SKIPPED,
// records the pause window on the customer, and extends the billing cycle by the exact
// count of missed delivery days.
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

  // The customer's delivery schedule decides which calendar days are actually skipped
  // (a Mon–Fri plan ignores the weekend inside the window).
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

  // 1) Mark every missed delivery date skipped. Upsert writes ONLY the skip flag, so a
  //    "Today Only" meal snapshot already saved for one of these dates is preserved.
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

  // 2) Record the pause window on the customer so it can be displayed + cancelled.
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

  // 3) Extend the paid billing cycle by the exact count of skipped delivery days.
  if (missedDates.length > 0) {
    await shiftCustomerCycleEnd(customerId, missedDates.length);
  }

  revalidatePath('/prep');
  return { success: true, skippedDays: missedDates.length, schemaAvailable: true };
}

// Cancels an active vacation pause: removes the skip rows it created, rolls the billing
// cycle back by that same count, and clears the pause window so meals resume.
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

  // Re-derive the SAME delivery days the pause skipped so exactly those rows are removed.
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

  // Roll back the cycle extension applied when the pause was scheduled.
  if (missedDates.length > 0) {
    await shiftCustomerCycleEnd(customerId, -missedDates.length);
  }

  // Clear the pause window so the customer resumes meals from the resume date on.
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

  revalidatePath('/prep');
  return { success: true, skippedDays: missedDates.length, schemaAvailable: true };
}


// ── Unified date-range override save ─────────────────────────────────────────
// One entry point for BOTH a meal customisation and a delivery skip, scoped to
// "Today Only", an explicit inclusive "Date Range", or the "Permanent Profile".
//
//   - today / range + isSkipped === true  → batch-writes `is_skipped: true` rows for
//     every active delivery day in the window and extends `cycle_end_date` by the number
//     of NEWLY skipped days (already-skipped days are never double-counted).
//   - today / range + isSkipped === false → batch-writes the custom meal snapshot onto
//     every delivery day in the window; days that were previously skipped are restored
//     (their cycle extension is rolled back).
//   - permanent → two-way syncs the master `customers` row and drops the selected day's
//     override so the date resolves from the (just updated) master profile.
//
// Because a range override lives in `customer_daily_overrides` keyed by date, every query
// automatically falls back to the master `customers` profile once the window passes — no
// cleanup job is needed.
export type SaveCustomerOverrideScope = 'today' | 'range' | 'permanent';

export type SaveCustomerOverrideInput = {
  customerId: string;
  scope: SaveCustomerOverrideScope;
  // Inclusive local YYYY-MM-DD window. "Today Only" sends the same key for both.
  startDate: string;
  endDate: string;
  // true → skip the window; false → write the custom meal profile / notes.
  isSkipped: boolean;
  // Full meal-config snapshot for the today/range meal path (ignored when isSkipped).
  mealConfig?: MealConfigPayload | null;
};

export type SaveCustomerOverrideResult = {
  success: boolean;
  scope: SaveCustomerOverrideScope;
  // Number of active delivery days the window resolved to.
  affectedDays: number;
  // Signed billing-cycle change applied (e.g. +3 for a 3-day skip).
  cycleDaysChanged: number;
  // false when customer_daily_overrides (or its PostgREST schema cache) is unavailable.
  schemaAvailable: boolean;
  message?: string;
};

// Every DELIVERY date inside the INCLUSIVE window [startDate, endDate] for the customer's
// schedule (ascending local YYYY-MM-DD keys). Weekend / off-schedule days are never
// generated, so a Mon–Fri customer accumulates no Sat/Sun overrides.
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
  // "Today Only" collapses the window to a single day.
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
      // Drop the selected day's override so it resolves from the updated master row.
      await deleteDailyOverride(customerId, startDate);
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
    return { success: true, scope, affectedDays: 0, cycleDaysChanged: 0, schemaAvailable: true };
  }

  // ── Today Only / Date Range ─────────────────────────────────────────────────
  // The customer's delivery_schedule decides which calendar days are actually affected
  // (a Mon–Fri plan ignores the weekend inside the window).
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

  // Nothing scheduled inside the window — nothing to write.
  if (dates.length === 0) {
    return { success: true, scope, affectedDays: 0, cycleDaysChanged: 0, schemaAvailable: true };
  }


  // Read the existing rows FIRST so a skip only extends the billing cycle for days that
  // were not already skipped, and an un-skip rolls exactly those extensions back.
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

    // Extend the paid cycle by the number of days that were not already skipped.
    const newlySkipped = dates.filter(date => !previouslySkipped.has(date));
    if (newlySkipped.length > 0) {
      await shiftCustomerCycleEnd(customerId, newlySkipped.length);
    }

    revalidatePath('/prep');
    return {
      success: true,
      scope,
      affectedDays: dates.length,
      cycleDaysChanged: newlySkipped.length,
      schemaAvailable: true,
    };
  }


  // ── Custom meal / notes (also the Undo-Skip path) ────────────────────────────
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
    // Writing the snapshot un-skips the day (this is how "Undo Skip" clears the flag).
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

  // Restoring days that were previously skipped rolls their cycle extension back.
  const restored = dates.filter(date => previouslySkipped.has(date));
  if (restored.length > 0) {
    await shiftCustomerCycleEnd(customerId, -restored.length);
  }

  revalidatePath('/prep');
  return {
    success: true,
    scope,
    affectedDays: dates.length,
    cycleDaysChanged: -restored.length,
    schemaAvailable: true,
  };
}
export async function renewCustomerSubscription({
  customerId,
  creditsToAdd,
  planTier,
}: {
  customerId: string;
  creditsToAdd: number;
  planTier?: 'trial' | 'weekly' | 'monthly';
}): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();

    // 1. Fetch current credits
    const { data: customer, error: fetchErr } = await supabase
      .from('customers')
      .select('id, total_tiffin_credits, plan_tier')
      .eq('id', customerId)
      .single();

    if (fetchErr || !customer) {
      return { success: false, message: fetchErr?.message || 'Customer not found' };
    }

    const currentCredits = Number(customer.total_tiffin_credits) || 0;
    const newTotal = currentCredits + creditsToAdd;
    const newTier = planTier || (newTotal >= 20 ? 'monthly' : newTotal > 1 ? 'weekly' : 'trial');

    // 2. Update total_tiffin_credits without modifying start_date
    const { error: updateErr } = await supabase
      .from('customers')
      .update({
        total_tiffin_credits: newTotal,
        plan_tier: newTier,
        subscription_status: 'active',
        cycle_end_date: null,
        scheduled_cancel_date: null,
        scheduled_status: null,
      })
      .eq('id', customerId);

    if (updateErr) {
      return { success: false, message: updateErr.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Failed to extend subscription',
    };
  }
}

export async function endCustomerSubscription(
  customerId: string,
  effectiveEndDate: string // Pass the date the cycle actually ended (e.g. "2026-09-16")
): Promise<{ success: boolean; message?: string }> {
  try {
    const { createClient } = await import('@/utils/supabase/server');
    const supabase = await createClient();

    const { error } = await supabase
      .from('customers')
      .update({
        cycle_end_date: effectiveEndDate,
        scheduled_cancel_date: effectiveEndDate,
        scheduled_status: 'cancelled',
        cancellation_reason: 'Non-renewal archived',
      })
      .eq('id', customerId);

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Could not end subscription.',
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