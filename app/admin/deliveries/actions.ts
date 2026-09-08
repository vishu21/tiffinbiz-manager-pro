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

// Ensures a customer is only fulfilled once per calendar day.
// Returns true when the log was newly inserted; false if already logged.
async function ensureDailyLog(
  customerId: string,
  event: 'delivered' | 'skipped'
): Promise<boolean> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('customer_deliveries')
    .select('id')
    .eq('customer_id', customerId)
    .eq('delivery_date', todayIso())
    .maybeSingle<{ id: string }>();

  if (existing) return false;

  const { error } = await supabase.from('customer_deliveries').insert({
    customer_id: customerId,
    delivery_date: todayIso(),
    event,
  });

  if (error) {
    // Unique (customer_id, delivery_date) collision = already logged.
    if (error.code === '23505') return false;
    console.error('Delivery log error:', error);
    throw new Error(error.message);
  }
  return true;
}

// Marks today's delivery as consumed (+1 used_credits) with ledger transitions:
//   next === total              → payment_status 'due'
//   next > total                → payment_status 'overdue'
//   next > total + 3 (grace)    → subscription_status 'expired'
export async function markDelivered(customerId: string) {
  const supabase = await createClient();

  const inserted = await ensureDailyLog(customerId, 'delivered');
  if (!inserted) {
    revalidatePath('/admin/deliveries');
    revalidatePath('/admin/customers');
    return; // Already marked today — do not double-charge a credit.
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

// Logs a skipped (non-delivered) day — no credit consumed.
export async function logSkip(customerId: string) {
  const supabase = await createClient();

  const inserted = await ensureDailyLog(customerId, 'skipped');
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
