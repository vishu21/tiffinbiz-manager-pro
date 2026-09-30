'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

type CreditCustomer = {
  id: string;
  plan_tier: string | null;
  total_tiffin_credits: number;
  used_credits: number;
  skipped_days_count: number;
  subscription_status: string | null;
};

const CREDITS_PER_TIER: Record<string, number> = {
  trial: 1,
  weekly: 5,
  monthly: 20,
};

// Resets the customer's credit cycle: used/skipped → 0, status → active.
export async function renewPlan(customerId: string) {
  const supabase = await createClient();
  const { data: cust } = await supabase
    .from('customers')
    .select('plan_tier, total_tiffin_credits')
    .eq('id', customerId)
    .single<{ plan_tier: string | null; total_tiffin_credits: number | null }>();

  const planTier = cust?.plan_tier || 'weekly';
  const totalCredits =
    cust?.total_tiffin_credits ?? CREDITS_PER_TIER[planTier] ?? CREDITS_PER_TIER.weekly;

  const { error } = await supabase
    .from('customers')
    .update({
      used_credits: 0,
      skipped_days_count: 0,
      subscription_status: 'active',
      total_tiffin_credits: totalCredits,
      plan_tier: planTier,
    })
    .eq('id', customerId);

  if (error) {
    console.error('Renew plan error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/deliveries');
}

const todayIso = () => new Date().toISOString().split('T')[0];

// Ensures a customer is only fulfilled once per target calendar day.
async function ensureDailyLog(
  customerId: string,
  event: 'delivered' | 'skipped',
  targetDate?: string
): Promise<boolean> {
  const supabase = await createClient();
  const dateKey = targetDate || todayIso();

  const { data: existing } = await supabase
    .from('customer_deliveries')
    .select('id')
    .eq('customer_id', customerId)
    .eq('delivery_date', dateKey)
    .maybeSingle<{ id: string }>();

  if (existing) return false;

  const { error } = await supabase.from('customer_deliveries').insert({
    customer_id: customerId,
    delivery_date: dateKey,
    event,
  });

  if (error) {
    if (error.code === '23505') return false;
    console.error('Delivery log error:', error);
    throw new Error(error.message);
  }
  return true;
}

export async function markDelivered(customerId: string, targetDate?: string) {
  const supabase = await createClient();
  const dateKey = targetDate || todayIso();

  const inserted = await ensureDailyLog(customerId, 'delivered', dateKey);
  if (!inserted) {
    revalidatePath('/admin/deliveries');
    revalidatePath('/admin/customers');
    return;
  }

  const { data: cust } = await supabase
    .from('customers')
    .select('id, total_tiffin_credits, used_credits, plan_tier, subscription_status')
    .eq('id', customerId)
    .single<CreditCustomer>();

  if (!cust) throw new Error('Customer not found');

  const total = cust.total_tiffin_credits || CREDITS_PER_TIER[cust.plan_tier || 'weekly'] || 5;
  const next = (cust.used_credits || 0) + 1;

  const update: Partial<CreditCustomer> & { payment_status?: string } = {
    used_credits: next,
    payment_status: next === total ? 'due' : next > total ? 'overdue' : 'paid',
    subscription_status: next > total + 3 ? 'expired' : 'active',
  };

  const { error } = await supabase.from('customers').update(update).eq('id', customerId);
  if (error) {
    console.error('Mark delivered error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/deliveries');
  revalidatePath('/admin/customers');
}

export async function logSkip(customerId: string, targetDate?: string) {
  const supabase = await createClient();
  const dateKey = targetDate || todayIso();

  const inserted = await ensureDailyLog(customerId, 'skipped', dateKey);
  if (!inserted) {
    revalidatePath('/admin/deliveries');
    revalidatePath('/admin/customers');
    return;
  }

  const { data: current } = await supabase
    .from('customers')
    .select('skipped_days_count')
    .eq('id', customerId)
    .single<{ skipped_days_count: number | null }>();

  if (!current) throw new Error('Customer not found');

  const next = (current.skipped_days_count || 0) + 1;
  const { error: updateError } = await supabase
    .from('customers')
    .update({ skipped_days_count: next })
    .eq('id', customerId);

  if (updateError) {
    console.error('Log skip error:', updateError);
    throw new Error(updateError.message);
  }

  revalidatePath('/admin/deliveries');
  revalidatePath('/admin/customers');
}

export async function undoTodayDispatchAction(customerId: string, targetDate?: string) {
  const supabase = await createClient();
  const dateKey = targetDate || todayIso();

  const { data: log } = await supabase
    .from('customer_deliveries')
    .select('event')
    .eq('customer_id', customerId)
    .eq('delivery_date', dateKey)
    .maybeSingle<{ event: 'delivered' | 'skipped' }>();

  if (!log) {
    revalidatePath('/admin/deliveries');
    revalidatePath('/admin/customers');
    return;
  }

  if (log.event === 'delivered') {
    const { data: cust } = await supabase
      .from('customers')
      .select('total_tiffin_credits, used_credits, subscription_status, plan_tier')
      .eq('id', customerId)
      .single<Pick<CreditCustomer, 'total_tiffin_credits' | 'used_credits' | 'subscription_status' | 'plan_tier'>>();

    if (!cust) throw new Error('Customer not found');

    const total = cust.total_tiffin_credits || CREDITS_PER_TIER[cust.plan_tier || 'weekly'] || 5;
    const next = Math.max(0, (cust.used_credits || 0) - 1);

    const update: { used_credits: number; payment_status: string; subscription_status?: string } = {
      used_credits: next,
      payment_status: next === total ? 'due' : next > total ? 'overdue' : 'paid',
    };
    if ((cust.subscription_status || '').toLowerCase() === 'expired') {
      update.subscription_status = next > total + 3 ? 'expired' : 'active';
    }

    const { error: updateError } = await supabase
      .from('customers')
      .update(update)
      .eq('id', customerId);
    if (updateError) {
      console.error('Undo delivered error:', updateError);
      throw new Error(updateError.message);
    }
  } else {
    const { data: current } = await supabase
      .from('customers')
      .select('skipped_days_count')
      .eq('id', customerId)
      .single<{ skipped_days_count: number | null }>();

    if (!current) throw new Error('Customer not found');

    const next = Math.max(0, (current.skipped_days_count || 0) - 1);
    const { error: updateError } = await supabase
      .from('customers')
      .update({ skipped_days_count: next })
      .eq('id', customerId);
    if (updateError) {
      console.error('Undo skip error:', updateError);
      throw new Error(updateError.message);
    }
  }

  const { error: deleteError } = await supabase
    .from('customer_deliveries')
    .delete()
    .eq('customer_id', customerId)
    .eq('delivery_date', dateKey);

  if (deleteError) {
    console.error('Undo delete log error:', deleteError);
    throw new Error(deleteError.message);
  }

  revalidatePath('/admin/deliveries');
  revalidatePath('/admin/customers');
}

export async function saveDeliveryRouteOrder(
  dateKey: string,
  stopOrder: string[]
): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from('daily_delivery_routes')
      .upsert(
        {
          delivery_date: dateKey,
          stop_order: stopOrder,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'delivery_date' }
      );

    if (error) {
      console.error('[saveDeliveryRouteOrder] Database Error:', error.message);
      return { success: false, message: error.message };
    }

    revalidatePath('/admin/deliveries');
    return { success: true };
  } catch (err) {
    console.error('[saveDeliveryRouteOrder] Exception:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Unknown server error' };
  }
}

/**
 * Saves route for `dateKey` AND forwards the updated sequence to future uncompleted dates.
 */
export async function saveRouteAndPropagateFuture(
  dateKey: string,
  stopOrder: string[],
  propagateDays: number = 7
): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();

    // 1. Save for the current date
    await supabase
      .from('daily_delivery_routes')
      .upsert(
        {
          delivery_date: dateKey,
          stop_order: stopOrder,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'delivery_date' }
      );

    // 2. Identify uncompleted future dates
    const futureDate = new Date(`${dateKey}T12:00:00`);
    const futureDateKeys: string[] = [];

    for (let i = 1; i <= propagateDays; i++) {
      const d = new Date(futureDate);
      d.setDate(futureDate.getDate() + i);
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      futureDateKeys.push(d.toISOString().slice(0, 10));
    }

    const { data: completedDates } = await supabase
      .from('customer_deliveries')
      .select('delivery_date')
      .in('delivery_date', futureDateKeys);

    const completedSet = new Set((completedDates || []).map((r: any) => r.delivery_date));
    const datesToOverwrite = futureDateKeys.filter(dk => !completedSet.has(dk));

    // Overwrite future uncompleted days so they stay aligned with today's master sequence
    if (datesToOverwrite.length > 0) {
      const upsertRows = datesToOverwrite.map(dk => ({
        delivery_date: dk,
        stop_order: stopOrder,
        updated_at: new Date().toISOString(),
      }));

      await supabase
        .from('daily_delivery_routes')
        .upsert(upsertRows, { onConflict: 'delivery_date' });
    }

    revalidatePath('/admin/deliveries');
    return { success: true };
  } catch (err: any) {
    console.error('[saveRouteAndPropagateFuture] Error:', err);
    return { success: false, message: err?.message || 'Failed to propagate route' };
  }
}

function parseStopOrder(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getDeliveryDateData(dateKey: string) {
  try {
    const supabase = await createClient();

    // 1. Fetch saved manual route order for this specific date
    const { data: routeRow } = await supabase
      .from('daily_delivery_routes')
      .select('stop_order')
      .eq('delivery_date', dateKey)
      .maybeSingle();

    // 2. Fetch logged deliveries using the correct column name: 'event'
    const { data: logs, error: logsError } = await supabase
      .from('customer_deliveries')
      .select('customer_id, event')
      .eq('delivery_date', dateKey);

    if (logsError) {
      console.error('[getDeliveryDateData] customer_deliveries query error:', logsError);
    }

    const todayLogs = (logs || []).map((l: any) => ({
      customerId: String(l.customer_id),
      event: (l.event === 'skipped' ? 'skipped' : 'delivered') as 'delivered' | 'skipped',
    }));

    let routeOrder: string[] = parseStopOrder(routeRow?.stop_order);

    // 3. If deliveries were completed, the actual delivered sequence takes precedence
    if (todayLogs.length > 0) {
      const deliveredIds = todayLogs.map(l => l.customerId);
      if (deliveredIds.length >= routeOrder.length) {
        routeOrder = deliveredIds;
      }
    }

    // 4. Inherit route from the most recent active delivery day if this day has no route yet
    if (routeOrder.length === 0) {
      const { data: prevRoutes } = await supabase
        .from('daily_delivery_routes')
        .select('delivery_date, stop_order')
        .lt('delivery_date', dateKey)
        .order('delivery_date', { ascending: false })
        .limit(5);

      if (prevRoutes && prevRoutes.length > 0) {
        for (const prev of prevRoutes) {
          const parsed = parseStopOrder(prev.stop_order);
          if (parsed.length > 0) {
            routeOrder = parsed;
            break;
          }
        }
      }
    }

    return {
      routeOrder,
      todayLogs,
    };
  } catch (err) {
    console.error('[getDeliveryDateData] unexpected error:', err);
    return {
      routeOrder: [],
      todayLogs: [],
    };
  }
}