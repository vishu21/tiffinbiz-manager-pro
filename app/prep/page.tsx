import { createClient } from '@/utils/supabase/server';
import PrepDashboardClient from './PrepDashboardClient';

export const dynamic = 'force-dynamic'; // Ensures the dashboard always fetches the latest live data

export default async function PrepPage() {
  const supabase = await createClient();
  
  // Fetch all customers from your database
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*');

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