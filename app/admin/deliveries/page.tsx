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
  // Pickup-day columns (migration 00011). delivery_address doubles as the legacy
  // PICKUP-marker source for records created before pickup_days existed.
  delivery_address?: string | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  // Optional: upcoming-start (migration 00008) + scheduled end (migration 00014) gates
  // used to decide whether a customer belongs on TODAY's dispatch list.
  start_date?: string | null;
  scheduled_cancel_date?: string | null;
};

export default async function DeliveriesPage() {
  const supabase = await createClient();

  // Customer list and today's delivery log are independent — fetch them in
  // parallel so a tab switch isn't blocked by two sequential DB round-trips.
  const customersPromise = (async (): Promise<CustomerRow[]> => {
    try {
      // Requires migrations 00006 + 00007; falls back to legacy fields if not applied yet.
      const { data, error } = await supabase
        .from('customers')
        .select(
          'id, full_name, plan_tier, total_tiffin_credits, used_credits, skipped_days_count, subscription_status, status, delivery_schedule, delivery_address, is_pickup, pickup_days, start_date, scheduled_cancel_date'
        )
        .order('full_name', { ascending: true });

      if (error) throw error;
      return (data || []) as CustomerRow[];
    } catch {
      const { data } = await supabase
        .from('customers')
        .select('id, full_name, subscription_status, status, delivery_schedule, delivery_address')
        .order('full_name', { ascending: true });
      return ((data || []) as {
        id: string;
        full_name: string;
        subscription_status: string | null;
        status: string | null;
        delivery_schedule: string | null;
        delivery_address: string | null;
      }[]).map(c => ({
        ...c,
        plan_tier: 'weekly',
        total_tiffin_credits: 5,
        used_credits: 0,
        skipped_days_count: 0,
        // Legacy-schema fallback: treat as already-started / no scheduled end.
        start_date: null,
        scheduled_cancel_date: null,
      }));
    }
  })();

  // Optional daily log (migration 00010). Safe to skip when not applied yet.
  const dailyLogsPromise = supabase
    .from('customer_deliveries')
    .select('customer_id, event')
    .eq('delivery_date', new Date().toISOString().split('T')[0]);

  const [customers, dailyLogsResult] = await Promise.all([customersPromise, dailyLogsPromise]);

  const todayLogs = ((dailyLogsResult.data as {
    customer_id: string;
    event: 'delivered' | 'skipped';
  }[] | null) || []).map(r => ({ customerId: r.customer_id, event: r.event }));

  return <DeliveriesClient initialCustomers={customers} todayLogs={todayLogs} />;
}
