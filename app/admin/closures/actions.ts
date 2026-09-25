'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { parseActiveScheduleDays } from '@/app/utils/customerPickup';
import { computeCycleEndDate } from '@/app/utils/subscriptionCycle';

const DAYS_OF_WEEK = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const isWeekday = (date: Date): boolean => {
  const d = date.getDay();
  return d !== 0 && d !== 6;
};

// Delegates to the SHARED cycle calculator (app/utils/subscriptionCycle.ts) so closure
// credit grants/reversals re-walk the cycle with the exact same rules as /prep and
// /admin/customers. Falls back to the anchor date when the inputs are unusable.
const walkDeliveryDays = (startDateStr: string, totalMeals: number): string =>
  computeCycleEndDate({ startDate: startDateStr, totalMeals }) ?? startDateStr.slice(0, 10);

const getWeekdayDatesInRange = (startDateStr: string, endDateStr: string): string[] => {
  const dates: string[] = [];
  const current = new Date(`${startDateStr.slice(0, 10)}T00:00:00`);
  const end = new Date(`${endDateStr.slice(0, 10)}T00:00:00`);

  while (current <= end) {
    if (isWeekday(current)) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

export type ClosureImpactSimulation = {
  closureDates: string[];
  totalCustomersCredited: number;
  totalCreditsDisbursed: number;
  customerBreakdown: Array<{
    customerId: string;
    customerName: string;
    creditsToAdd: number;
    currentCredits: number;
    newCredits: number;
  }>;
};

export async function simulateKitchenClosure(
  startDateStr: string,
  endDateStr: string
): Promise<ClosureImpactSimulation> {
  const supabase = await createClient();
  const closureDates = getWeekdayDatesInRange(startDateStr, endDateStr);

  if (closureDates.length === 0) {
    return {
      closureDates: [],
      totalCustomersCredited: 0,
      totalCreditsDisbursed: 0,
      customerBreakdown: [],
    };
  }

  const { data: customers } = await supabase
    .from('customers')
    .select(`
      id,
      full_name,
      start_date,
      cycle_end_date,
      total_tiffin_credits,
      delivery_schedule,
      subscription_status,
      pause_start_date,
      pause_end_date
    `)
    .eq('subscription_status', 'active');

  const { data: overrides } = await supabase
    .from('customer_daily_overrides')
    .select('customer_id, override_date, is_skipped')
    .in('override_date', closureDates);

  const skippedMap = new Set(
    (overrides || [])
      .filter(o => o.is_skipped)
      .map(o => `${o.customer_id}_${o.override_date}`)
  );

  const customerCreditMap = new Map<string, { name: string; creditsToAdd: number; currentCredits: number }>();

  for (const c of customers || []) {
    const scheduledDays = parseActiveScheduleDays(c.delivery_schedule);
    const currentCredits = c.total_tiffin_credits || 20;
    const computedEnd = c.cycle_end_date?.slice(0, 10) ||
      (c.start_date ? walkDeliveryDays(c.start_date, currentCredits) : null);

    let creditsToAdd = 0;

    for (const dStr of closureDates) {
      if (skippedMap.has(`${c.id}_${dStr}`)) continue;

      if (c.pause_start_date && dStr >= c.pause_start_date) {
        if (!c.pause_end_date || dStr < c.pause_end_date) continue;
      }

      const dayName = DAYS_OF_WEEK[new Date(`${dStr}T00:00:00`).getDay()];
      if (!scheduledDays.includes(dayName)) continue;

      if (c.start_date && dStr < c.start_date.slice(0, 10)) continue;
      if (computedEnd && dStr > computedEnd) continue;

      creditsToAdd++;
    }

    if (creditsToAdd > 0) {
      customerCreditMap.set(c.id, {
        name: c.full_name,
        creditsToAdd,
        currentCredits,
      });
    }
  }

  let totalDisbursed = 0;
  const breakdown: ClosureImpactSimulation['customerBreakdown'] = [];

  customerCreditMap.forEach((val, id) => {
    totalDisbursed += val.creditsToAdd;
    breakdown.push({
      customerId: id,
      customerName: val.name,
      creditsToAdd: val.creditsToAdd,
      currentCredits: val.currentCredits,
      newCredits: val.currentCredits + val.creditsToAdd,
    });
  });

  return {
    closureDates,
    totalCustomersCredited: breakdown.length,
    totalCreditsDisbursed: totalDisbursed,
    customerBreakdown: breakdown,
  };
}

export async function scheduleKitchenClosureRange(
  startDateStr: string,
  endDateStr: string,
  reason: string
) {
  const supabase = await createClient();
  const closureDates = getWeekdayDatesInRange(startDateStr, endDateStr);

  if (closureDates.length === 0) {
    throw new Error('No delivery weekdays found in the selected date range.');
  }

  const simulation = await simulateKitchenClosure(startDateStr, endDateStr);

  const closureRows = closureDates.map(d => ({
    closure_date: d,
    reason: reason.trim() || 'Kitchen Holiday',
  }));

  const { data: createdClosures, error: insertError } = await supabase
    .from('kitchen_closures')
    .insert(closureRows)
    .select('id, closure_date');

  if (insertError) {
    if (insertError.code === '23505') {
      throw new Error('One or more dates in this range are already marked as closed.');
    }
    throw new Error(insertError.message);
  }

  const primaryClosureId = createdClosures?.[0]?.id;

  // Execute customer updates concurrently instead of 51 sequential round-trips
  if (simulation.customerBreakdown.length > 0) {
    await Promise.all(
      simulation.customerBreakdown.map(async (item) => {
        const { data: customer, error: custError } = await supabase
          .from('customers')
          .select('start_date, total_tiffin_credits, cycle_end_date')
          .eq('id', item.customerId)
          .single();

        if (custError || !customer) return;

        const nextCredits = (customer.total_tiffin_credits || 20) + item.creditsToAdd;
        const nextEnd = customer.start_date
          ? walkDeliveryDays(customer.start_date, nextCredits)
          : customer.cycle_end_date;

        await Promise.all([
          supabase
            .from('customers')
            .update({
              total_tiffin_credits: nextCredits,
              cycle_end_date: nextEnd,
            })
            .eq('id', item.customerId),
          supabase.from('credit_ledger').insert([{
            customer_id: item.customerId,
            amount: item.creditsToAdd,
            reason: `Kitchen Holiday: ${reason.trim() || 'Holiday'} (${startDateStr} to ${endDateStr})`,
            closure_id: primaryClosureId,
          }]),
        ]);
      })
    );
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  revalidatePath('/admin/closures');

  return {
    success: true,
    createdDaysCount: closureDates.length,
    creditedCustomersCount: simulation.totalCustomersCredited,
    totalCreditsDisbursed: simulation.totalCreditsDisbursed,
  };
}

export async function cancelKitchenClosure(closureId: string) {
  const supabase = await createClient();

  const { data: grants, error: fetchError } = await supabase
    .from('credit_ledger')
    .select('customer_id, amount')
    .eq('closure_id', closureId);

  if (fetchError) throw new Error(fetchError.message);

  if (grants && grants.length > 0) {
    await Promise.all(
      grants.map(async (grant) => {
        const { data: customer } = await supabase
          .from('customers')
          .select('start_date, total_tiffin_credits, cycle_end_date')
          .eq('id', grant.customer_id)
          .single();

        if (!customer) return;

        const currentCredits = customer.total_tiffin_credits || 20;
        const revertedCredits = Math.max(1, currentCredits - grant.amount);
        const revertedEnd = customer.start_date
          ? walkDeliveryDays(customer.start_date, revertedCredits)
          : customer.cycle_end_date;

        await Promise.all([
          supabase
            .from('customers')
            .update({
              total_tiffin_credits: revertedCredits,
              cycle_end_date: revertedEnd,
            })
            .eq('id', grant.customer_id),
          supabase.from('credit_ledger').insert([{
            customer_id: grant.customer_id,
            amount: -grant.amount,
            reason: `Reversal of Kitchen Closure (${closureId})`,
          }]),
        ]);
      })
    );
  }

  // Nullify foreign key references before deleting the closure
  await supabase
    .from('credit_ledger')
    .update({ closure_id: null })
    .eq('closure_id', closureId);

  const { error: delError } = await supabase
    .from('kitchen_closures')
    .delete()
    .eq('id', closureId);

  if (delError) throw new Error(delError.message);

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  revalidatePath('/admin/closures');

  return { success: true, reversedCount: grants?.length || 0 };
}

export async function cancelKitchenClosureBatch(closureIds: string[]) {
  const supabase = await createClient();

  const { data: grants, error: fetchError } = await supabase
    .from('credit_ledger')
    .select('customer_id, amount, closure_id')
    .in('closure_id', closureIds);

  if (fetchError) throw new Error(fetchError.message);

  const customerReversalMap = new Map<string, number>();
  (grants || []).forEach(g => {
    const current = customerReversalMap.get(g.customer_id) || 0;
    customerReversalMap.set(g.customer_id, current + g.amount);
  });

  const reversalEntries = Array.from(customerReversalMap.entries());

  if (reversalEntries.length > 0) {
    await Promise.all(
      reversalEntries.map(async ([customerId, totalCreditsToDeduct]) => {
        const { data: customer } = await supabase
          .from('customers')
          .select('start_date, total_tiffin_credits, cycle_end_date')
          .eq('id', customerId)
          .single();

        if (!customer) return;

        const currentCredits = customer.total_tiffin_credits || 20;
        const revertedCredits = Math.max(1, currentCredits - totalCreditsToDeduct);
        const revertedEnd = customer.start_date
          ? walkDeliveryDays(customer.start_date, revertedCredits)
          : customer.cycle_end_date;

        await Promise.all([
          supabase
            .from('customers')
            .update({
              total_tiffin_credits: revertedCredits,
              cycle_end_date: revertedEnd,
            })
            .eq('id', customerId),
          supabase.from('credit_ledger').insert([{
            customer_id: customerId,
            amount: -totalCreditsToDeduct,
            reason: `Reversal of Multi-Day Closure Block (${closureIds.length} days)`,
          }]),
        ]);
      })
    );
  }

  // Clear foreign key references so Postgres doesn't block the deletion
  await supabase
    .from('credit_ledger')
    .update({ closure_id: null })
    .in('closure_id', closureIds);

  const { error: delError } = await supabase
    .from('kitchen_closures')
    .delete()
    .in('id', closureIds);

  if (delError) throw new Error(delError.message);

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
  revalidatePath('/admin/closures');

  return { success: true, reversedCount: closureIds.length };
}