import { createClient } from '@/utils/supabase/server';
import { applyScheduledStatusTransitions } from '@/app/admin/actions';
import CustomerSplitLayout from './CustomerSplitLayout';

export default async function CustomersPage() {
  const supabase = await createClient();

  // Apply any due scheduled cancel/pause dates first so every status below is current.
  await applyScheduledStatusTransitions();

  // Pull records right on the edge server
  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });

  return <CustomerSplitLayout initialCustomers={customers || []} />;
}