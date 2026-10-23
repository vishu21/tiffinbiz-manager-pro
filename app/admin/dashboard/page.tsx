import { createClient } from '@/utils/supabase/server';
import DashboardClient from './DashboardClient';
import { toLocalDateKey } from '@/app/utils/subscriptionCycle';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const todayKey = toLocalDateKey(new Date());

  // 1. Parallel fetch of all operational data needed for the command center
  const [
    customersRes,
    deliveriesRes,
    closuresRes,
    overridesRes,
    menuRes,
    recipesRes,
    settingsRes,
  ] = await Promise.all([
    // All subscribers (active, paused, cancelled)
    supabase
      .from('customers')
      .select('*')
      .order('full_name', { ascending: true }),

    // Today's delivery activity logs (completed deliveries)
    supabase
      .from('customer_deliveries')
      .select('customer_id, delivery_date, status')
      .eq('delivery_date', todayKey),

    // Active kitchen holidays / closures
    supabase
      .from('kitchen_closures')
      .select('id, closure_date, reason')
      .order('closure_date', { ascending: true }),

    // Customer daily overrides (skips, special meal requests)
    supabase
      .from('customer_daily_overrides')
      .select('*')
      .gte('override_date', todayKey),

    // Today's configured kitchen menu
    supabase
      .from('daily_menus')
      .select('date, veg_option_1, veg_option_2, chicken_option')
      .eq('date', todayKey)
      .maybeSingle(),

    // Available recipes catalog for dish names
    supabase
      .from('menu_recipes')
      .select('id, name, category')
      .order('name', { ascending: true }),

    // App & Kitchen settings (address, notification templates)
    supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle(),
  ]);

  // Log non-blocking read errors to console for observability
  if (customersRes.error) {
    console.error('[Dashboard Loader] Failed to fetch customers:', customersRes.error);
  }
  if (deliveriesRes.error) {
    console.error('[Dashboard Loader] Failed to fetch deliveries:', deliveriesRes.error.message || deliveriesRes.error);
  }

  // 2. Deliver clean data payload directly to the client UI component
  return (
    <DashboardClient
      todayKey={todayKey}
      initialCustomers={customersRes.data || []}
      todayDeliveries={(deliveriesRes.data || []).map((d: any) => ({
        customer_id: d.customer_id,
        delivery_date: d.delivery_date,
        status: d.status || 'delivered',
      }))}
      closures={closuresRes.data || []}
      upcomingOverrides={overridesRes.data || []}
      todayMenu={menuRes.data || null}
      availableRecipes={recipesRes.data || []}
      settings={settingsRes.data || null}
    />
  );
}