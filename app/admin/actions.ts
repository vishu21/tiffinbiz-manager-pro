'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

// Canonical default delivery plan: Mon–Fri as a comma-separated day list.
const DEFAULT_DELIVERY_SCHEDULE = 'Mon,Tue,Wed,Thu,Fri';

type CustomerPayload = {
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  pronthi_count: number | null;
  rice_count: string | null;
  delivery_schedule: string | null;
  delivery_instructions: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  subscription_status?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
};

// Normalizes optional metadata fields before hitting Supabase so empty/undefined values are
// handled gracefully:
//  - `curry_config` empty/whitespace → `null`
//  - any key explicitly `undefined` → removed from the payload (Supabase leaves it untouched)
const normalizeCustomerPayload = (payload: CustomerPayload): CustomerPayload => {
  const clean: CustomerPayload = { ...payload };

  // Fall back to the standard Mon–Fri weekday plan whenever the schedule is
  // undefined, null, empty, or whitespace-only.
  const schedule = clean.delivery_schedule?.trim();
  clean.delivery_schedule = schedule || DEFAULT_DELIVERY_SCHEDULE;

  // Phone is optional: trim it and store null when blank ("" → null).
  if (clean.phone_number === '' || clean.phone_number === null) {
    clean.phone_number = null;
  } else if (typeof clean.phone_number === 'string') {
    clean.phone_number = clean.phone_number.trim() || null;
  }

  // Pronthi is an integer bread count: coerce gracefully before sending.
  const pronthiNum = Number(clean.pronthi_count);
  clean.pronthi_count = Number.isFinite(pronthiNum)
    ? Math.max(0, Math.trunc(pronthiNum))
    : 0;

  if (clean.curry_config !== undefined && clean.curry_config !== null) {
    const trimmed = clean.curry_config.trim();
    clean.curry_config = trimmed === '' ? null : trimmed;
  }

  (Object.keys(clean) as (keyof CustomerPayload)[]).forEach(key => {
    if (clean[key] === undefined) delete clean[key];
  });

  return clean;
};

// Removes pronthi_count so a profile update can succeed before the migration runs.
const stripPronthiCount = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.pronthi_count;
  return copy;
};

// True when Supabase rejected the payload because the pronthi_count column is absent.
const isPronthiColumnMissing = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === 'PGRST204') return true;
  if (typeof e.message === 'string') {
    const msg = e.message.toLowerCase();
    return msg.includes('schema cache') && msg.includes('pronthi');
  }
  return false;
};

// 1. CREATE CUSTOMER
export async function createCustomer(payload: CustomerPayload) {
  const supabase = await createClient();
  const normalized = normalizeCustomerPayload(payload);
  const { error } = await supabase.from('customers').insert([normalized]);

  if (error && isPronthiColumnMissing(error)) {
    console.warn('Database schema missing pronthi_count, retrying without pronthi_count...');
    const retry = await supabase.from('customers').insert([stripPronthiCount(normalized)]);
    if (retry.error) {
      console.error('Database insertion error details:', retry.error);
      throw new Error(retry.error.message);
    }
  } else if (error) {
    console.error('Database insertion error details:', error);
    throw new Error(error.message); // This bubbles up to the alert on your screen!
  }

  revalidatePath('/admin/customers');
}

// 2. UPDATE CUSTOMER
export async function updateCustomer(id: string, payload: CustomerPayload) {
  const supabase = await createClient();
  const normalized = normalizeCustomerPayload(payload);
  const { error } = await supabase.from('customers').update(normalized).eq('id', id);

  if (error && isPronthiColumnMissing(error)) {
    console.warn('Database schema missing pronthi_count, retrying without pronthi_count...');
    const retry = await supabase
      .from('customers')
      .update(stripPronthiCount(normalized))
      .eq('id', id);
    if (retry.error) {
      console.error('Database update error details:', retry.error);
      throw new Error(retry.error.message);
    }
  } else if (error) {
    console.error('Database update error details:', error);
    throw new Error(error.message); // This bubbles up to the alert on your screen!
  }

  revalidatePath('/admin/customers');
}

// 3. DELETE CUSTOMER
export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
  revalidatePath('/admin/customers');
}

// 4. PAUSE CUSTOMER SERVICE
export async function pauseCustomer(id: string, startDate: string, endDate: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({
      subscription_status: 'paused',
      pause_start_date: startDate,
      pause_end_date: endDate,
    })
    .eq('id', id);

  if (error) {
    console.error('Database pause error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 5. CANCEL CUSTOMER SERVICE
export async function cancelCustomer(id: string, reason: string | null, cancelledAt?: string | null) {
  const supabase = await createClient();
  const now =
    cancelledAt && cancelledAt.trim() ? cancelledAt : new Date().toISOString();
  const { error } = await supabase
    .from('customers')
    .update({
      subscription_status: 'cancelled',
      cancellation_reason: reason,
      cancelled_at: now,
    })
    .eq('id', id);

  if (error) {
    console.error('Database cancel error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 6. RESUME CUSTOMER SERVICE
export async function resumeCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({
      subscription_status: 'active',
      pause_start_date: null,
      pause_end_date: null,
    })
    .eq('id', id);

  if (error) {
    console.error('Database resume error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 7. UPDATE CANCELLATION DETAILS (date + reason only — never touches meal/carb prefs)
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

// 8. REACTIVATE CANCELLED CUSTOMER SERVICE
export async function reactivateCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({
      subscription_status: 'active',
    })
    .eq('id', id);

  if (error) {
    console.error('Database reactivate error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 9. GET CUSTOMER COUNTS BY STATUS
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

// 10. ADDRESS SUGGESTIONS WRAPPER
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
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Server-side geocoding failed securely:", error);
    return []; 
  }
}