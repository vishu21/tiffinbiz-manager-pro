import { createClient } from '@/utils/supabase/server';
import { applyScheduledStatusTransitions } from '@/app/admin/actions';
import PrepDashboardClient from './PrepDashboardClient';

export const dynamic = 'force-dynamic'; // Ensures the dashboard always fetches the latest live data

export default async function PrepPage() {
  const supabase = await createClient();
  
  // Flip any due scheduled cancel/pause dates so today's manifest reflects them (no cron).
  await applyScheduledStatusTransitions();

  // Fetch active and paused customers (paused customers may resume on future dates)
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .or('subscription_status.eq.active,subscription_status.eq.paused,subscription_status.is.null');

  if (error) {
    const raw = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };
    console.error(
      `Error fetching customers for prep dashboard: ${raw.message || "(no error message)"}\n` +
        `  code:    ${raw.code || "(none)"}\n` +
        `  hint:    ${raw.hint || "(none)"}\n` +
        `  details: ${raw.details || "(none)"}\n` +
        `  full:    ${JSON.stringify(error)}`
    );
  }

  return (
    <main>
      <PrepDashboardClient initialCustomers={customers || []} />
    </main>
  );
}