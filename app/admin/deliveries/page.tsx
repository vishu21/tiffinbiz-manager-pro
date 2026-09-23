import { createClient } from '@/utils/supabase/server';
import DeliveriesClient from './DeliveriesClient';

export const dynamic = 'force-dynamic';

export default async function DeliveriesPage() {
  const supabase = await createClient();

  const { data: rawCustomers, error: custError } = await supabase
    .from('customers')
    .select('*')
    .order('full_name', { ascending: true });

  if (custError) {
    console.error('❌ [DELIVERIES PAGE ERROR]:', custError);
  }

  const customers = (rawCustomers || []).map((c: any) => ({
    id: c.id,
    full_name: c.full_name || 'Unnamed',
    phone_number: c.phone_number || null,
    plan_tier: c.plan_tier || 'weekly',
    total_tiffin_credits:
      c.total_tiffin_credits ??
      c.total_credits ??
      (c.plan_tier === 'trial' ? 1 : c.plan_tier === 'monthly' ? 20 : 5),
    used_credits: c.used_credits ?? 0,
    skipped_days_count: c.skipped_days_count ?? 0,
    subscription_status: c.subscription_status || 'active',
    status: c.status || 'active',
    delivery_schedule: c.delivery_schedule || 'Monday to Friday',
    delivery_address: c.delivery_address || '',
    delivery_instructions: c.delivery_instructions || null,
    dietary_notes: c.dietary_notes || null,
    meal_type: c.meal_type || 'Veg',
    portion_size: c.portion_size || 'RG',
    roti_count: c.roti_count ?? null,
    is_pickup: c.is_pickup || false,
    pickup_days: c.pickup_days || [],
    start_date: c.start_date || null,
    cycle_end_date: c.cycle_end_date || null,
    scheduled_cancel_date: c.scheduled_cancel_date || null,
    pause_start_date: c.pause_start_date || null,
    pause_end_date: c.pause_end_date || null,
  }));

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const localToday = `${y}-${m}-${d}`;

  let todayLogs: { customerId: string; event: 'delivered' | 'skipped' }[] = [];
  try {
    const { data: logsData } = await supabase
      .from('customer_deliveries')
      .select('customer_id, event')
      .eq('delivery_date', localToday);

    if (logsData) {
      todayLogs = logsData.map((r: any) => ({
        customerId: r.customer_id,
        event: r.event,
      }));
    }
  } catch (err) {
    console.warn('[Deliveries Page] customer_deliveries query bypassed:', err);
  }

  return <DeliveriesClient initialCustomers={customers} todayLogs={todayLogs} />;
}