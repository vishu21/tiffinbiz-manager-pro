import { createClient } from '@/utils/supabase/server';

export default async function AdminDashboard() {
  const supabase = await createClient();

  const { data: customers } = await supabase
    .from('customers')
    .select('subscription_status');

  const totalActive = (customers || []).filter(
    c => c.subscription_status === 'active' || !c.subscription_status
  ).length;
  const totalPaused = (customers || []).filter(c => c.subscription_status === 'paused').length;
  const totalCancelled = (customers || []).filter(c => c.subscription_status === 'cancelled').length;
  const totalAll = (customers || []).length;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Admin Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="p-6 bg-white rounded-lg shadow border border-gray-200">
          <h2 className="text-gray-500 text-sm font-medium">Total Customers</h2>
          <p className="text-3xl font-bold mt-2">{totalAll}</p>
        </div>
        <div className="p-6 bg-white rounded-lg shadow border border-green-100 border-l-4 border-l-green-500">
          <h2 className="text-gray-500 text-sm font-medium">🟢 Active</h2>
          <p className="text-3xl font-bold mt-2 text-green-600">{totalActive}</p>
        </div>
        <div className="p-6 bg-white rounded-lg shadow border border-amber-100 border-l-4 border-l-amber-500">
          <h2 className="text-gray-500 text-sm font-medium">🟡 Paused</h2>
          <p className="text-3xl font-bold mt-2 text-amber-600">{totalPaused}</p>
        </div>
        <div className="p-6 bg-white rounded-lg shadow border border-red-100 border-l-4 border-l-red-500">
          <h2 className="text-gray-500 text-sm font-medium">🔴 Cancelled</h2>
          <p className="text-3xl font-bold mt-2 text-red-600">{totalCancelled}</p>
        </div>
      </div>
    </div>
  );
}