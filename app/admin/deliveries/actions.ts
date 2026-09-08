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

// Marks today's delivery as consumed (+1 used_credits). Auto-expires the plan when the
// new used count reaches the plan's total credits.
export async function markDelivered(customerId: string) {
  const supabase = await createClient();

  const { data: cust } = await supabase
    .from('customers')
    .select('id, total_tiffin_credits, used_credits, skipped_days_count, plan_tier')
    .eq('id', customerId)
    .single<CreditCustomer>();

  if (!cust) throw new Error('Customer not found');

  const total = cust.total_tiffin_credits || CREDITS_PER_TIER[cust.plan_tier || 'weekly'] || 5;
  const used = (cust.used_credits || 0) + 1;

  const update: Partial<CreditCustomer> = { used_credits: used };
  if (used >= total) {
    // Plan fully consumed → mark expired so it drops out of today's dispatch list.
    update.subscription_status = 'expired';
  }

  const { error } = await supabase.from('customers').update(update).eq('id', customerId);
  if (error) {
    console.error('Mark delivered error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/deliveries');
  revalidatePath('/admin/customers');
}

// Logs a skipped (non-delivered) day without consuming a credit.
export async function logSkip(customerId: string) {
  const supabase = await createClient();

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
}
