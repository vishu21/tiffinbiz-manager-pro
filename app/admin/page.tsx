import { createClient } from '@/utils/supabase/server';
import { Circle } from 'lucide-react';

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
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0">
      {/* ── UNIFIED STANDARD PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200/80 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
              Admin Overview
            </h1>
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 text-xs font-bold rounded-full">
              {totalAll}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
            System performance, subscriber metrics, and active meal plans.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="p-5 bg-white rounded-2xl shadow-2xs border border-gray-200/90">
          <h2 className="text-gray-500 text-xs font-bold uppercase tracking-wider">Total Customers</h2>
          <p className="text-3xl font-black mt-2 text-[#11142D]">{totalAll}</p>
        </div>
        <div className="p-5 bg-white rounded-2xl shadow-2xs border border-gray-200/90 border-l-4 border-l-emerald-500">
          <h2 className="text-emerald-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" /> Active
          </h2>
          <p className="text-3xl font-black mt-2 text-emerald-600">{totalActive}</p>
        </div>
        <div className="p-5 bg-white rounded-2xl shadow-2xs border border-gray-200/90 border-l-4 border-l-amber-500">
          <h2 className="text-amber-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Circle className="w-2 h-2 fill-amber-500 text-amber-500" /> Paused
          </h2>
          <p className="text-3xl font-black mt-2 text-amber-600">{totalPaused}</p>
        </div>
        <div className="p-5 bg-white rounded-2xl shadow-2xs border border-gray-200/90 border-l-4 border-l-rose-500">
          <h2 className="text-rose-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Circle className="w-2 h-2 fill-rose-500 text-rose-500" /> Cancelled
          </h2>
          <p className="text-3xl font-black mt-2 text-rose-600">{totalCancelled}</p>
        </div>
      </div>
    </div>
  );
}