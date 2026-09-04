import { createClient } from '@/utils/supabase/server';
import CustomerSplitLayout from './CustomerSplitLayout';

export default async function CustomersPage() {
  const supabase = await createClient();

  // Pull records right on the edge server
  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });

  return <CustomerSplitLayout initialCustomers={customers || []} />;
}