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
    const { error } = await supabase.from('daily_delivery_routes').upsert(
      {
        delivery_date: dateKey,
        stop_order: stopOrder,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'delivery_date' }
    );

    if (error) {
      console.error('[saveDeliveryRouteOrder] Error:', error.message);
      return { success: false, message: error.message };
    }

    revalidatePath('/admin/deliveries');
    return { success: true };
  } catch (err) {
    console.error('[saveDeliveryRouteOrder] Exception:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function getDeliveryDateData(dateKey: string) {
  const supabase = await createClient();

  const [logsRes, routeRes] = await Promise.all([
    supabase
      .from('customer_deliveries')
      .select('customer_id, event')
      .eq('delivery_date', dateKey),
    supabase
      .from('daily_delivery_routes')
      .select('stop_order')
      .eq('delivery_date', dateKey)
      .maybeSingle(),
  ]);

  return {
    todayLogs: (logsRes.data || []).map((r: any) => ({
      customerId: r.customer_id,
      event: r.event as 'delivered' | 'skipped',
    })),
    routeOrder: (routeRes.data?.stop_order as string[]) || [],
  };
}