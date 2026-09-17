import { createClient } from '@/utils/supabase/server';
import ClosuresClient from './ClosuresClient';

export const dynamic = 'force-dynamic';

export default async function ClosuresPage() {
  const supabase = await createClient();

  const [{ data: closures }, { data: ledger }] = await Promise.all([
    supabase
      .from('kitchen_closures')
      .select('*')
      .order('closure_date', { ascending: false }),
    supabase
      .from('credit_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <ClosuresClient
      initialClosures={closures || []}
      initialLedger={ledger || []}
    />
  );
}