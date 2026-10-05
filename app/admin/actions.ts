'use server';

import { createClient } from '@/utils/supabase/server';
import { geocodeAddress } from '@/app/utils/geocoding';
import { revalidatePath } from 'next/cache';
import { normalizePickupDays } from '@/app/utils/customerPickup';

// Canonical default delivery plan: Mon–Fri as a comma-separated day list.
const DEFAULT_DELIVERY_SCHEDULE = 'Mon,Tue,Wed,Thu,Fri';

// Plan tier → tiffin credits included per cycle.
const TIER_CREDITS: Record<string, number> = {
  trial: 1,
  weekly: 5,
  monthly: 20,
};

type CustomerPayload = {
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  cycle_end_date?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  dietary_notes: string | null;
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  pronthi_count?: number | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  rice_count: string | null;
  delivery_schedule: string | null;
  delivery_instructions: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  plan_tier?: 'trial' | 'weekly' | 'monthly' | null;
  total_tiffin_credits?: number | null;
  start_date?: string | null;
  subscription_status?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  scheduled_cancel_date?: string | null;
  scheduled_status?: 'cancelled' | 'paused' | null;
  referred_by?: string | null;
  disliked_dishes?: string[] | null;
};

// Dish dislikes/exclusions are stored as a text[] on customers. Trim, drop empties,
// and de-duplicate case-insensitively while preserving the operator's display casing.
const normalizeDislikedDishes = (list: string[] | null | undefined): string[] => {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  list.forEach(item => {
    const trimmed = String(item ?? '').trim();
    const key = trimmed.toLowerCase();
    if (trimmed !== '' && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  });
  return out;
};

const normalizeCustomerPayload = (payload: CustomerPayload): CustomerPayload => {
  const clean: CustomerPayload = { ...payload };

  const schedule = clean.delivery_schedule?.trim();
  clean.delivery_schedule = schedule || DEFAULT_DELIVERY_SCHEDULE;

  if (clean.phone_number === '' || clean.phone_number === null) {
    clean.phone_number = null;
  } else if (typeof clean.phone_number === 'string') {
    clean.phone_number = clean.phone_number.trim() || null;
  }

  const pronthiNum = Number(clean.pronthi_count);
  clean.pronthi_count = Number.isFinite(pronthiNum)
    ? Math.max(0, Math.trunc(pronthiNum))
    : 0;

  if (clean.pickup_days !== undefined && clean.pickup_days !== null) {
    clean.pickup_days = normalizePickupDays(clean.pickup_days);
  }
  if (clean.is_pickup === undefined || clean.is_pickup === null) {
    clean.is_pickup = (clean.pickup_days?.length ?? 0) > 0;
  }

  if (
    clean.is_pickup &&
    typeof clean.delivery_address === 'string' &&
    clean.delivery_address.trim() === ''
  ) {
    clean.delivery_address = 'Kitchen Pickup';
  }

  if (clean.curry_config !== undefined && clean.curry_config !== null) {
    const trimmed = clean.curry_config.trim();
    clean.curry_config = trimmed === '' ? null : trimmed;
  }

  if (clean.plan_tier !== undefined && clean.plan_tier !== null) {
    const tier = clean.plan_tier;
    clean.plan_tier = tier === 'trial' || tier === 'weekly' || tier === 'monthly' ? tier : 'monthly';
  } else if (clean.plan_tier === undefined) {
    clean.plan_tier = 'monthly';
  }
  if (clean.total_tiffin_credits !== undefined && clean.total_tiffin_credits !== null) {
    const credits = Number(clean.total_tiffin_credits);
    clean.total_tiffin_credits = Number.isFinite(credits)
      ? Math.max(1, Math.trunc(credits))
      : TIER_CREDITS[clean.plan_tier || 'monthly'];
  } else if (clean.total_tiffin_credits === undefined || clean.total_tiffin_credits === null) {
    clean.total_tiffin_credits = TIER_CREDITS[clean.plan_tier || 'monthly'];
  }
  if (clean.start_date !== undefined) {
    const start = clean.start_date?.trim();
    clean.start_date = start ? start : null;
  }

  if (clean.referred_by !== undefined) {
    const referral = clean.referred_by?.trim();
    clean.referred_by = referral ? referral : null;
  }

  if (clean.disliked_dishes !== undefined) {
    clean.disliked_dishes = normalizeDislikedDishes(clean.disliked_dishes);
  }

  (Object.keys(clean) as (keyof CustomerPayload)[]).forEach(key => {
    if (clean[key] === undefined) delete clean[key];
  });

  return clean;
};

const stripPronthiCount = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.pronthi_count;
  return copy;
};

const stripCoordinates = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.delivery_lat;
  delete copy.delivery_lng;
  return copy;
};

const isMissingColumnError = (error: unknown, names: string[]): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  const wanted = names.map(name => name.toLowerCase());
  if (e.code === 'PGRST204' || e.code === '42703') {
    return wanted.some(name => text.includes(name));
  }
  return (
    typeof e.message === 'string' &&
    e.message.toLowerCase().includes('does not exist') &&
    wanted.some(name => text.includes(name))
  );
};

const isPronthiColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['pronthi_count']);

const isCoordinatesColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['delivery_lat', 'delivery_lng']);

const stripPickupColumns = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.is_pickup;
  delete copy.pickup_days;
  return copy;
};

const isPickupColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['pickup_days', 'is_pickup']);

const stripReferredByColumn = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.referred_by;
  return copy;
};

const isReferredByColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['referred_by']);

const stripDislikedDishes = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.disliked_dishes;
  return copy;
};

const isDislikedDishesColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['disliked_dishes']);

const SCHEDULED_COLUMNS = ['scheduled_cancel_date', 'scheduled_status'];
const SCHEDULE_MIGRATION_HINT =
  'Scheduling a future cancel/pause requires supabase/migrations/00014_add_scheduled_status.sql. Please run the migration and try again.';

const isScheduledColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, SCHEDULED_COLUMNS);

const stripScheduledColumns = (payload: Record<string, unknown>): Record<string, unknown> => {
  const copy = { ...payload };
  delete copy.scheduled_cancel_date;
  delete copy.scheduled_status;
  return copy;
};

const probeScheduledColumn = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: string
): Promise<boolean> => {
  const { error } = await supabase.from('customers').select(column).limit(1);
  if (!error) return true;
  return !isMissingColumnError(error, [column]);
};

const probeScheduledColumns = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: string
): Promise<{ present: string[]; missing: string[] }> => {
  const present: string[] = [];
  const missing: string[] = [];
  for (const column of SCHEDULED_COLUMNS) {
    if (await probeScheduledColumn(supabase, column)) present.push(column);
    else missing.push(column);
  }
  console.info(
    `[${context}] customers scheduled columns — present: [${present.join(', ') || 'none'}]` +
    ` | missing: [${missing.join(', ') || 'none'}]`
  );
  return { present, missing };
};

const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const serverDateKey = (): string => toDateKey(new Date());

const runCustomerStatusUpdate = async (
  id: string,
  payload: Record<string, unknown>,
  options: { requiresScheduledColumns: boolean; context: string }
) => {
  const supabase = await createClient();
  let current = { ...payload };

  if (options.requiresScheduledColumns) {
    let probe = await probeScheduledColumns(supabase, options.context);
    if (probe.missing.length > 0) {
      const { error: reloadError } = await supabase.rpc('notify_pgrst_reload');
      if (!reloadError) {
        await new Promise(resolve => setTimeout(resolve, 400));
        probe = await probeScheduledColumns(supabase, options.context);
      }
    }

    if (probe.missing.length > 0) {
      console.error(
        `[${options.context}] customers is missing scheduled column(s): [${probe.missing.join(', ')}]. ` +
        'Run supabase/migrations/00014_add_scheduled_status.sql in the Supabase SQL Editor.'
      );
      throw new Error(SCHEDULE_MIGRATION_HINT);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('customers').update(current).eq('id', id);
    if (!error) return;
    if (isScheduledColumnMissing(error)) {
      if (options.requiresScheduledColumns) {
        console.error(`[${options.context}] Scheduled columns are missing on the database.`, error);
        throw new Error(SCHEDULE_MIGRATION_HINT);
      }
      current = stripScheduledColumns(current);
      continue;
    }
    console.error(`[${options.context}] Database update error:`, error);
    throw new Error(error.message);
  }
  throw new Error(`${options.context} failed after stripping optional schema columns.`);
};

type DatabaseErrorShape = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const readDatabaseError = (error: unknown): DatabaseErrorShape => {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const e = error as DatabaseErrorShape;
  return {
    code: e.code ?? null,
    message: e.message ?? String(error),
    details: e.details ?? null,
    hint: e.hint ?? null,
  };
};

const logDatabaseError = (context: string, error: unknown) => {
  const e = readDatabaseError(error);
  console.error(`[${context}] Supabase rejected the database write.`, {
    code: e.code,
    message: e.message,
    details: e.details,
    hint: e.hint,
    raw: error,
  });
};

const formatDatabaseError = (error: unknown): string => {
  const e = readDatabaseError(error);
  const parts = [
    e.message || String(error),
    e.details ? `details: ${e.details}` : '',
    e.hint ? `hint: ${e.hint}` : '',
    e.code ? `code: ${e.code}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
};

const isDuplicatePhoneError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string | null; message?: string | null; details?: string | null };
  if (e.code !== '23505') return false;
  const text = [e.message, e.details].filter(Boolean).join(' ').toLowerCase();
  return text.includes('phone_number') || text.includes('customers_phone_number_key');
};

const DUPLICATE_PHONE_MESSAGE =
  'A customer with this phone number already exists. Please modify the phone number or adjust database constraints.';

const formatCustomerWriteError = (error: unknown): string =>
  isDuplicatePhoneError(error) ? DUPLICATE_PHONE_MESSAGE : formatDatabaseError(error);

// 1. CREATE CUSTOMER
export async function createCustomer(payload: CustomerPayload) {
  const supabase = await createClient();

  // Geocode address automatically if present
  if (payload.delivery_address && !payload.is_pickup) {
    try {
      const coords = await geocodeAddress(payload.delivery_address);
      if (coords) {
        payload.delivery_lat = coords.lat;
        payload.delivery_lng = coords.lng;
      }
    } catch (e) {
      console.warn('[createCustomer] Geocoding skipped:', e);
    }
  }

  const normalized = normalizeCustomerPayload(payload);

  const attemptInsert = async (row: CustomerPayload): Promise<Record<string, unknown> | null> => {
    let current = { ...row };
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('customers')
        .insert([current])
        .select('*')
        .single();
      if (!error) return data;
      if (isPronthiColumnMissing(error)) {
        current = stripPronthiCount(current);
        continue;
      }
      if (isCoordinatesColumnMissing(error)) {
        current = stripCoordinates(current);
        continue;
      }
      if (isPickupColumnMissing(error)) {
        current = stripPickupColumns(current);
        continue;
      }
      if (isReferredByColumnMissing(error)) {
        current = stripReferredByColumn(current);
        continue;
      }
      if (isDislikedDishesColumnMissing(error)) {
        current = stripDislikedDishes(current);
        continue;
      }
      logDatabaseError('createCustomer.insert', error);
      throw new Error(formatCustomerWriteError(error));
    }
    throw new Error('Customer insert failed after stripping optional schema columns.');
  };

  const created = (await attemptInsert(normalized)) ?? null;
  revalidatePath('/admin/customers');
  revalidatePath('/prep');
  revalidatePath('/admin/deliveries');
  return created;
}

// 2. UPDATE CUSTOMER
export async function updateCustomer(
  id: string,
  payload: CustomerPayload
): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();

  // Geocode address automatically if present
  if (payload.delivery_address && !payload.is_pickup) {
    try {
      const coords = await geocodeAddress(payload.delivery_address);
      if (coords) {
        payload.delivery_lat = coords.lat;
        payload.delivery_lng = coords.lng;
      }
    } catch (e) {
      console.warn('[updateCustomer] Geocoding skipped:', e);
    }
  }

  const normalized = normalizeCustomerPayload(payload);

  let current = { ...normalized };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('customers')
      .update(current)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (!error) {
      revalidatePath('/admin/customers');
      revalidatePath('/prep');
      revalidatePath('/admin/deliveries');
      return data;
    }
    if (isPronthiColumnMissing(error)) {
      current = stripPronthiCount(current);
      continue;
    }
    if (isCoordinatesColumnMissing(error)) {
      current = stripCoordinates(current);
      continue;
    }
    if (isPickupColumnMissing(error)) {
      current = stripPickupColumns(current);
      continue;
    }
    if (isReferredByColumnMissing(error)) {
      current = stripReferredByColumn(current);
      continue;
    }
    if (isDislikedDishesColumnMissing(error)) {
      current = stripDislikedDishes(current);
      continue;
    }
    logDatabaseError('updateCustomer.update', error);
    throw new Error(formatCustomerWriteError(error));
  }
  throw new Error('Customer update failed after stripping optional schema columns.');
}

// 3. DELETE CUSTOMER
export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
  revalidatePath('/admin/customers');
  revalidatePath('/admin/deliveries');
}

// 4. PAUSE CUSTOMER SERVICE
export async function pauseCustomer(id: string, lastServiceDate: string, endDate: string | null) {
  const effectiveDate =
    (lastServiceDate || serverDateKey()).trim().slice(0, 10) || serverDateKey();
  const isScheduled = effectiveDate > serverDateKey();

  await runCustomerStatusUpdate(
    id,
    isScheduled
      ? {
        pause_start_date: null,
        pause_end_date: endDate,
        scheduled_cancel_date: effectiveDate,
        scheduled_status: 'paused',
      }
      : {
        subscription_status: 'paused',
        pause_start_date: effectiveDate,
        pause_end_date: endDate,
        scheduled_cancel_date: null,
        scheduled_status: null,
      },
    { context: 'pauseCustomer', requiresScheduledColumns: isScheduled }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 5. CANCEL CUSTOMER SERVICE
export async function cancelCustomer(id: string, reason: string | null, cancelledAt?: string | null) {
  const effective = cancelledAt && cancelledAt.trim() ? cancelledAt : new Date().toISOString();
  const effectiveDate = effective.slice(0, 10);
  const isScheduled = effectiveDate > serverDateKey();

  await runCustomerStatusUpdate(
    id,
    isScheduled
      ? {
        cancellation_reason: reason,
        cancelled_at: null,
        scheduled_cancel_date: effectiveDate,
        scheduled_status: 'cancelled',
      }
      : {
        subscription_status: 'cancelled',
        cancellation_reason: reason,
        cancelled_at: effective,
        scheduled_cancel_date: null,
        scheduled_status: null,
      },
    { context: 'cancelCustomer', requiresScheduledColumns: isScheduled }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 5b. APPLY DUE SCHEDULED STATUS CHANGES
export async function applyScheduledStatusTransitions(): Promise<number> {
  const supabase = await createClient();
  const today = serverDateKey();

  const { data, error } = await supabase
    .from('customers')
    .select('id, scheduled_cancel_date, scheduled_status, pause_end_date')
    .not('scheduled_status', 'is', null)
    .lt('scheduled_cancel_date', today);

  if (error) {
    if (isScheduledColumnMissing(error)) return 0;
    console.error('Database scheduled-status transition read error:', error);
    return 0;
  }

  if (!data || data.length === 0) return 0;

  let transitioned = 0;
  for (const row of data) {
    const scheduledDate = row.scheduled_cancel_date as string | null;
    const scheduledStatus = row.scheduled_status as 'cancelled' | 'paused' | null;
    if (!scheduledDate || !scheduledStatus) continue;

    const payload: Record<string, unknown> =
      scheduledStatus === 'cancelled'
        ? {
          subscription_status: 'cancelled',
          is_active: false,
          cancelled_at: new Date(`${scheduledDate}T00:00:00`).toISOString(),
          scheduled_cancel_date: null,
          scheduled_status: null,
        }
        : {
          subscription_status: 'paused',
          pause_start_date: scheduledDate,
          pause_end_date: row.pause_end_date ?? null,
          scheduled_cancel_date: null,
          scheduled_status: null,
        };

    let updateError = (
      await supabase.from('customers').update(payload).eq('id', row.id)
    ).error;

    if (updateError && isMissingColumnError(updateError, ['is_active'])) {
      const withoutIsActive = { ...payload };
      delete withoutIsActive.is_active;
      updateError = (
        await supabase.from('customers').update(withoutIsActive).eq('id', row.id)
      ).error;
    }

    if (!updateError) transitioned++;
  }

  return transitioned;
}

// 5c. CLEAR PENDING SCHEDULED CANCELLATION
export async function clearScheduledCancellation(customerId: string) {
  await runCustomerStatusUpdate(
    customerId,
    {
      scheduled_cancel_date: null,
      scheduled_status: null,
      cancellation_reason: null,
    },
    { context: 'clearScheduledCancellation', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 6. RESUME CUSTOMER SERVICE
export async function resumeCustomer(id: string) {
  await runCustomerStatusUpdate(
    id,
    {
      subscription_status: 'active',
      pause_start_date: null,
      pause_end_date: null,
      scheduled_cancel_date: null,
      scheduled_status: null,
    },
    { context: 'resumeCustomer', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 6b. RENEW CREDIT CYCLE
export async function renewCustomerCycle(customerId: string) {
  const supabase = await createClient();

  const { data: cust } = await supabase
    .from('customers')
    .select('used_credits, total_tiffin_credits')
    .eq('id', customerId)
    .single<{ used_credits: number | null; total_tiffin_credits: number | null }>();

  if (!cust) throw new Error('Customer not found');

  const used = cust.used_credits || 0;
  const total = cust.total_tiffin_credits || 20;
  const graceUsed = Math.max(0, used - total);
  const nextUsed = Math.min(graceUsed, 20);

  const { error } = await supabase
    .from('customers')
    .update({
      total_tiffin_credits: 20,
      used_credits: nextUsed,
      skipped_days_count: 0,
      payment_status: 'paid',
      subscription_status: 'active',
    })
    .eq('id', customerId);

  if (error) {
    console.error('Renew cycle error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/deliveries');
}

// 6c. UPGRADE PLAN
export async function upgradeCustomerPlan(customerId: string, newTier: 'weekly' | 'monthly') {
  const supabase = await createClient();

  const credits = TIER_CREDITS[newTier];
  if (!credits) throw new Error('Unknown plan tier');

  const { data: cust } = await supabase
    .from('customers')
    .select('used_credits')
    .eq('id', customerId)
    .single<{ used_credits: number | null }>();

  if (!cust) throw new Error('Customer not found');

  const used = cust.used_credits || 0;
  const { error: updateError } = await supabase
    .from('customers')
    .update({
      plan_tier: newTier,
      total_tiffin_credits: used + credits,
      payment_status: 'paid',
      subscription_status: 'active',
    })
    .eq('id', customerId);

  if (updateError) {
    console.error('Upgrade plan error:', updateError);
    throw new Error(updateError.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/deliveries');
}

// 7. UPDATE CANCELLATION DETAILS
export async function updateCancellationDetails(
  id: string,
  cancelledAt: string,
  reason: string | null
) {
  const supabase = await createClient();
  const timestamp =
    cancelledAt && cancelledAt.trim() ? cancelledAt : new Date().toISOString();
  const { error } = await supabase
    .from('customers')
    .update({
      cancelled_at: timestamp,
      cancellation_reason: reason,
    })
    .eq('id', id);

  if (error) {
    console.error('Database cancellation details update error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 8. REACTIVATE CANCELLED CUSTOMER
export async function reactivateCustomer(id: string) {
  await runCustomerStatusUpdate(
    id,
    {
      subscription_status: 'active',
      scheduled_cancel_date: null,
      scheduled_status: null,
    },
    { context: 'reactivateCustomer', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 8b. UPDATE MEAL CONFIG QUICK SHEET
export type MealConfigPayload = {
  meal_type?: 'Veg' | 'Non-veg';
  portion_size?: string;
  roti_count?: number;
  pronthi_count?: number;
  rice_count?: string;
  dietary_notes?: string | null;
  delivery_instructions?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  disliked_dishes?: string[] | null;
};

export async function updateCustomerMealConfig(id: string, config: MealConfigPayload) {
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (config.meal_type !== undefined) {
    payload.meal_type = config.meal_type === 'Veg' ? 'Veg' : 'Non-veg';
  }
  if (config.portion_size !== undefined) {
    payload.portion_size = String(config.portion_size || '').trim() || 'RG';
  }
  if (config.roti_count !== undefined) {
    const roti = Number(config.roti_count);
    payload.roti_count = Number.isFinite(roti) ? Math.max(0, Math.trunc(roti)) : 0;
  }
  if (config.pronthi_count !== undefined) {
    const pronthi = Number(config.pronthi_count);
    payload.pronthi_count = Number.isFinite(pronthi) ? Math.max(0, Math.trunc(pronthi)) : 0;
  }
  if (config.rice_count !== undefined) {
    payload.rice_count = String(config.rice_count || '').trim() || 'None';
  }
  if (config.dietary_notes !== undefined) {
    payload.dietary_notes = String(config.dietary_notes || '').trim() || null;
  }
// Inside updateCustomerMealConfig:
if (config.delivery_instructions !== undefined) {
  const { data: existing } = await supabase
    .from('customers')
    .select('delivery_instructions')
    .eq('id', id)
    .single();

  const noteMatch = (existing?.delivery_instructions || '').match(/\[NOTE:\s*(.*?)\]/i);
  if (noteMatch && config.delivery_instructions && !config.delivery_instructions.includes('[NOTE:')) {
    config.delivery_instructions = `${config.delivery_instructions} [NOTE: ${noteMatch[1].trim()}]`;
  }
}
  if (config.is_custom_curry !== undefined) {
    payload.is_custom_curry = config.is_custom_curry === true;
  }
  if (config.curry_config !== undefined) {
    const curry = String(config.curry_config || '').trim();
    payload.curry_config = curry === '' ? null : curry;
  }
  if (config.disliked_dishes !== undefined) {
    payload.disliked_dishes = normalizeDislikedDishes(config.disliked_dishes);
  }

  if (Object.keys(payload).length === 0) return;

  let current = { ...payload };
  const { error } = await supabase
    .from('customers')
    .update(current)
    .eq('id', id);

  if (error) {
    // Tolerate environments where migration 00024 (disliked_dishes) isn't applied yet.
    if (current.disliked_dishes !== undefined && isDislikedDishesColumnMissing(error)) {
      delete current.disliked_dishes;
      const retry = await supabase.from('customers').update(current).eq('id', id);
      if (retry.error) {
        console.error('Database meal config quick-sheet update error:', retry.error);
        throw new Error(retry.error.message);
      }
    } else {
      console.error('Database meal config quick-sheet update error:', error);
      throw new Error(error.message);
    }
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
}

// 9. GET CUSTOMER COUNTS
export async function getCustomerCounts() {
  const supabase = await createClient();
  const { data: all } = await supabase.from('customers').select('subscription_status');

  if (!all) return { total: 0, active: 0, paused: 0, cancelled: 0 };

  return {
    total: all.length,
    active: all.filter(c => c.subscription_status === 'active' || !c.subscription_status).length,
    paused: all.filter(c => c.subscription_status === 'paused').length,
    cancelled: all.filter(c => c.subscription_status === 'cancelled').length,
  };
}

// 10. ADDRESS SEARCH
export async function searchAddress(query: string) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}+Ontario&addressdetails=1&limit=5&countrycodes=ca`,
      {
        headers: {
          'User-Agent': 'TiffinManager-Internal-App/1.0 (admin@local)',
          'Accept-Language': 'en-CA,en;q=0.9'
        }
      }
    );
    if (!res.ok) throw new Error(`OSM status: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("Server-side geocoding failed securely:", error);
    return [];
  }
}

// 11. ONE-TIME BATCH COORDINATES BACKFILL
export async function backfillExistingCustomerCoordinates(): Promise<{ updated: number; total: number }> {
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from('customers')
    .select('id, delivery_address, delivery_lat, delivery_lng')
    .is('delivery_lat', null);

  if (!customers || customers.length === 0) return { updated: 0, total: 0 };

  let updatedCount = 0;
  for (const c of customers) {
    if (!c.delivery_address || c.delivery_address.toLowerCase().includes('pickup')) continue;

    const coords = await geocodeAddress(c.delivery_address);
    if (coords) {
      await supabase
        .from('customers')
        .update({ delivery_lat: coords.lat, delivery_lng: coords.lng })
        .eq('id', c.id);
      updatedCount++;
    }
    // Respect Nominatim 1 req/sec rate limit
    await new Promise(r => setTimeout(r, 1100));
  }

  revalidatePath('/admin/deliveries');
  return { updated: updatedCount, total: customers.length };
}

// 12. CUSTOMER AUDIT ACTIVITY LOGS
export type CustomerActivityLog = {
  id: string;
  customer_id: string;
  action_type: string;
  summary: string;
  changed_fields: Record<string, { from: unknown; to: unknown }> | null;
  performed_by: string;
  created_at: string;
};

export async function getCustomerActivityLogs(customerId: string): Promise<CustomerActivityLog[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customer_activity_logs')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Logs] Failed to fetch customer activity logs:', error);
      return [];
    }
    return (data as CustomerActivityLog[]) || [];
  } catch (err) {
    console.error('[Logs] Error fetching logs:', err);
    return [];
  }
}

export async function addManualCustomerLog(params: {
  customerId: string;
  summary: string;
  actionType?: string;
  date?: string;
}) {
  try {
    const supabase = await createClient();
    const timestamp = params.date
      ? new Date(`${params.date}T12:00:00`).toISOString()
      : new Date().toISOString();

    const { data, error } = await supabase
      .from('customer_activity_logs')
      .insert({
        customer_id: params.customerId,
        action_type: params.actionType || 'NOTE',
        summary: params.summary.trim(),
        created_at: timestamp,
        performed_by: 'staff',
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, log: data };
  } catch (err) {
    console.error('[Logs] Failed to add manual log:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Failed to save log' };
  }
}

export type RecordPaymentPayload = {
  customerId: string;
  amount: number;
  paymentMethod: 'etransfer' | 'cash' | 'card' | 'other';
  paidAt?: string | null;
  creditsAdded: number;
  cycleAction: 'settle_current' | 'renew_next' | 'topup' | 'historical';
  referenceNote?: string | null;
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  markStatusAs?: 'paid' | 'due' | 'overdue';
};

export async function recordCustomerPayment(payload: RecordPaymentPayload) {
  const supabase = await createClient();

  // 1. Insert transaction into ledger with the date received
  const { data: payment, error: paymentError } = await supabase
    .from('customer_payments')
    .insert({
      customer_id: payload.customerId,
      amount: payload.amount,
      payment_method: payload.paymentMethod,
      payment_status: 'completed',
      paid_at: payload.paidAt || toDateKey(new Date()),
      credits_added: payload.creditsAdded,
      cycle_action: payload.cycleAction,
      billing_cycle_start: payload.billingCycleStart || null,
      billing_cycle_end: payload.billingCycleEnd || null,
      reference_note: payload.referenceNote || null,
    })
    .select()
    .single();

  if (paymentError) throw new Error(paymentError.message);

  // 2. If this is a historical/past cycle payment, do NOT alter the customer's active cycle
  if (payload.cycleAction === 'historical') {
    revalidatePath('/admin/customers');
    revalidatePath('/admin/billing');
    return { success: true, payment };
  }

  // 3. Update customer record for active cycle actions
  const customerUpdates: Record<string, any> = {
    payment_status: payload.markStatusAs || 'paid',
  };

  if (payload.cycleAction === 'renew_next') {
    const { data: cust } = await supabase
      .from('customers')
      .select('used_credits, total_tiffin_credits')
      .eq('id', payload.customerId)
      .single();

    const used = cust?.used_credits || 0;
    const total = cust?.total_tiffin_credits || 20;
    const graceUsed = Math.max(0, used - total);

    customerUpdates.used_credits = graceUsed;
    customerUpdates.total_tiffin_credits = payload.creditsAdded;
    if (payload.billingCycleStart) customerUpdates.start_date = payload.billingCycleStart;
    if (payload.billingCycleEnd) customerUpdates.cycle_end_date = payload.billingCycleEnd;
  } else if (payload.cycleAction === 'topup') {
    const { data: cust } = await supabase
      .from('customers')
      .select('total_tiffin_credits')
      .eq('id', payload.customerId)
      .single();

    customerUpdates.total_tiffin_credits = (cust?.total_tiffin_credits || 0) + payload.creditsAdded;
  }

  const { error: custError } = await supabase
    .from('customers')
    .update(customerUpdates)
    .eq('id', payload.customerId);

  if (custError) throw new Error(custError.message);

  revalidatePath('/admin/customers');
  revalidatePath('/admin/billing');
  return { success: true, payment };
}

export async function getCustomerPayments(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_payments')
    .select('*')
    .eq('customer_id', customerId)
    .order('recorded_at', { ascending: false });

  if (error) return [];
  return data;
}
export async function updateCustomerPayment(
  paymentId: string,
  payload: {
    amount: number;
    paymentMethod: 'etransfer' | 'cash' | 'card' | 'other';
    creditsAdded?: number;
    cycleAction?: 'settle_current' | 'renew_next' | 'topup';
    billingCycleStart?: string | null;
    billingCycleEnd?: string | null;
    referenceNote?: string | null;
  }
) {
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from('customer_payments')
    .update({
      amount: payload.amount,
      payment_method: payload.paymentMethod,
      credits_added: payload.creditsAdded ?? 20,
      cycle_action: payload.cycleAction ?? 'settle_current',
      billing_cycle_start: payload.billingCycleStart ?? null,
      billing_cycle_end: payload.billingCycleEnd ?? null,
      reference_note: payload.referenceNote ?? null,
    })
    .eq('id', paymentId)
    .select()
    .single();

  if (error) {
    console.error('Update payment error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/billing');
  return { success: true, payment: updated };
}

export async function deleteCustomerPayment(paymentId: string, customerId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from('customer_payments')
    .delete()
    .eq('id', paymentId);

  if (error) {
    console.error('Delete payment error:', error);
    throw new Error(error.message);
  }

  // Refresh customer payment status check if ledger becomes empty
  const { data: remaining } = await supabase
    .from('customer_payments')
    .select('id')
    .eq('customer_id', customerId);

  if (!remaining || remaining.length === 0) {
    await supabase
      .from('customers')
      .update({ payment_status: 'due' })
      .eq('id', customerId);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/billing');
  return { success: true };
}