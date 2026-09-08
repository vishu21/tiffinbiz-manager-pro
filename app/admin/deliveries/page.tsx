import { createClient } from '@/utils/supabase/server';
import DeliveriesClient from './DeliveriesClient';

type CustomerRow = {
  id: string;
  full_name: string;
  plan_tier: string | null;
  total_tiffin_credits: number | null;
  used_credits: number | null;
  skipped_days_count: number | null;
  subscription_status: string | null;
  status: string | null;
  delivery_schedule: string | null;
};

export default async function DeliveriesPage() {
  const supabase = await createClient();

  let customers: CustomerRow[] = [];

  try {
    // Requires migrations 00006 + 00007; falls back to legacy fields if not applied yet.
    const { data, error } = await supabase
      .from('customers')
      .select(
        'id, full_name, plan_tier, total_tiffin_credits, used_credits, skipped_days_count, subscription_status, status, delivery_schedule'
      )
      .order('full_name', { ascending: true });

    if (error) throw error;
    customers = (data || []) as CustomerRow[];
  } catch {
    const { data } = await supabase
      .from('customers')
      .select('id, full_name, subscription_status, status, delivery_schedule')
      .order('full_name', { ascending: true });
    customers = (data || []).map(c => ({
      ...c,
      plan_tier: 'weekly',
      total_tiffin_credits: 5,
      used_credits: 0,
      skipped_days_count: 0,
    }));
  }

  // Optional daily log (migration 00010). Safe to skip when not applied yet.
  const { data: dailyLogs } = await supabase
    .from('customer_deliveries')
    .select('customer_id, event')
    .eq('delivery_date', new Date().toISOString().split('T')[0]);
  const todayLogs = ((dailyLogs as { customer_id: string; event: 'delivered' | 'skipped' }[] | null) || []).map(
    r => ({ customerId: r.customer_id, event: r.event })
  );

  return <DeliveriesClient initialCustomers={customers} todayLogs={todayLogs} />;
}
