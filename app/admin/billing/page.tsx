import { createClient } from '@/utils/supabase/server';
import BillingTableClient from './BillingTableClient';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: payments }] = await Promise.all([
    supabase
      .from('customers')
      .select('*')
      .order('full_name', { ascending: true }),
    supabase
      .from('customer_payments')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(100),
  ]);

  const customerList = customers || [];
  const paymentList = payments || [];

  // Summary Metrics
  const dueCount = customerList.filter(c => {
    const isPaid = c.payment_status === 'paid';
    const used = c.used_credits ?? 0;
    const total = c.total_tiffin_credits ?? 20;
    return !isPaid && used <= total;
  }).length;

  const overdueCount = customerList.filter(c => {
    const isPaid = c.payment_status === 'paid';
    const used = c.used_credits ?? 0;
    const total = c.total_tiffin_credits ?? 20;
    return !isPaid && used > total;
  }).length;

  const paidCount = customerList.filter(c => c.payment_status === 'paid').length;

  const thisMonthTotal = paymentList
    .filter(p => {
      const pDate = new Date(p.recorded_at);
      const now = new Date();
      return pDate.getMonth() === now.getMonth() && pDate.getFullYear() === now.getFullYear();
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0 font-sans antialiased text-[#292D32]">
      {/* ── HEADER ── */}
      <div className="border-b border-gray-200/80 pb-4 shrink-0">
        <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
          Billing &amp; Payments
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
          Track subscriber renewals, log cash and e-Transfers, and collect outstanding balances.
        </p>
      </div>

      {/* ── KPI METRIC CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 shrink-0">
        <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-2xs">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
            Collected This Month
          </span>
          <span className="text-xl sm:text-2xl font-black text-emerald-600 block mt-1">
            ${thisMonthTotal.toFixed(2)} CAD
          </span>
        </div>

        <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-2xs">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
            Subscriptions Due
          </span>
          <span className="text-xl sm:text-2xl font-black text-amber-600 block mt-1">
            {dueCount} Active
          </span>
        </div>

        <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-2xs">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
            Overdue Accounts
          </span>
          <span className="text-xl sm:text-2xl font-black text-rose-600 block mt-1">
            {overdueCount} Past Due
          </span>
        </div>

        <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-2xs">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
            Settled / Paid Up
          </span>
          <span className="text-xl sm:text-2xl font-black text-indigo-600 block mt-1">
            {paidCount} Customers
          </span>
        </div>
      </div>

      {/* ── INTERACTIVE RECEIVABLES TABLE ── */}
      <BillingTableClient initialCustomers={customerList} recentPayments={paymentList} />
    </div>
  );
}