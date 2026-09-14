'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { markDelivered, logSkip, renewPlan, undoTodayDispatchAction } from './actions';
import { isPickupOnDay } from '@/app/utils/customerPickup';

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
  // used to decide whether a customer belongs on today's dispatch list.
  start_date?: string | null;
  scheduled_cancel_date?: string | null;
};

const noopSubscribe = () => () => {};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function isScheduledOn(schedule: string | null | undefined, weekdayName: string): boolean {
  if (!schedule || schedule === '—') return false;
  const short = weekdayName.substring(0, 3);
  const except = schedule.match(/\[EXCEPT:\s*(.*?)\]/i);
  if (except && except[1].toLowerCase().includes(short.toLowerCase())) return false;
  if (schedule.includes('Monday to Friday')) return WEEKDAYS.includes(weekdayName);
  return schedule.includes(weekdayName) || schedule.toLowerCase().includes(short.toLowerCase());
}

const tierBadge: Record<string, string> = {
  trial: 'bg-sky-50 text-sky-700 border-sky-200',
  weekly: 'bg-blue-50 text-blue-700 border-blue-200',
  monthly: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

type DailyLog = { customerId: string; event: 'delivered' | 'skipped' };

export default function DeliveriesClient({
  initialCustomers,
  todayLogs,
}: {
  initialCustomers: CustomerRow[];
  todayLogs: DailyLog[];
}) {
  const router = useRouter();
  const isMounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [tab, setTab] = useState<'dispatch' | 'ledger'>('dispatch');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [renewedAt, setRenewedAt] = useState<{ id: string; at: string } | null>(null);

  const todayName = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }, []);

  // Local calendar "today" key (YYYY-MM-DD) used for start_date / scheduled_cancel_date
  // comparisons on the dispatch list (avoids UTC rollover skew).
  const todayKey = useMemo(() => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }, []);

  const customers = useMemo(
    () =>
      initialCustomers.map(c => ({
        ...c,
        plan_tier: c.plan_tier || 'weekly',
        total_tiffin_credits: c.total_tiffin_credits ?? (c.plan_tier === 'trial' ? 1 : c.plan_tier === 'monthly' ? 20 : 5),
        used_credits: c.used_credits ?? 0,
        skipped_days_count: c.skipped_days_count ?? 0,
      })),
    [initialCustomers]
  );

  const todayLoggedIds = useMemo(() => todayLogs.map(l => l.customerId), [todayLogs]);

  const completedList = useMemo(
    () =>
      todayLogs
        .flatMap(log => {
          const customer = customers.find(c => c.id === log.customerId);
          return customer ? [{ ...log, customer }] : [];
        })
        .sort((a, b) => a.customer.full_name.localeCompare(b.customer.full_name)),
    [customers, todayLogs]
  );

  const dispatchList = useMemo(
    () =>
      customers.filter(
        c =>
          (c.subscription_status || 'active').toLowerCase() === 'active' &&
          (c.status || 'active').toLowerCase() !== 'paused' &&
          // Upcoming subscriptions (start_date still in the future) are not dispatched
          // until their start date arrives.
          (!c.start_date || c.start_date <= todayKey) &&
          // Scheduled end: the customer is served through their scheduled_cancel_date
          // and dropped once it has passed (even before the scheduled transition runs).
          (!c.scheduled_cancel_date || c.scheduled_cancel_date >= todayKey) &&
          (c.used_credits || 0) < (c.total_tiffin_credits || 0) + 3 &&
          isScheduledOn(c.delivery_schedule, todayName) &&
          // Customers picking up from the kitchen today don't need a driver.
          !isPickupOnDay(c, todayName) &&
          !todayLoggedIds.includes(c.id)
      ),
    [customers, todayName, todayKey, todayLoggedIds]
  );

  const ledgerList = useMemo(
    () =>
      customers.filter(c => ['active', 'expired', 'paused'].includes((c.subscription_status || 'active').toLowerCase())),
    [customers]
  );

  if (!isMounted) {
    return (
      <div className="h-full flex-1 flex items-center justify-center bg-[#FDFDFD]">
        <div className="text-gray-400 text-sm">Loading deliveries…</div>
      </div>
    );
  }

  async function run(action: () => Promise<void>) {
    setErrorMsg('');
    try {
      await action();
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  const planTier = (tier: string | null) => (tier === 'trial' ? 'Trial' : tier === 'monthly' ? 'Monthly' : 'Weekly');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#FDFDFD]">
      <div className="px-8 py-5 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#11142D] tracking-tight">Deliveries</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">Credit-ledger dispatch &amp; subscription tracking</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8 flex gap-1.5">
        {(
          [
            { key: 'dispatch', label: '📦 Daily Dispatch', hint: dispatchList.length },
            { key: 'ledger', label: '📒 Subscription Ledger', hint: ledgerList.length },
          ] as const
        ).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-t-lg text-[13px] font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? 'text-[#5D5FEF] border-[#5D5FEF] bg-white'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[11px] text-gray-400">({t.hint})</span>
          </button>
        ))}
      </div>

      <div className="px-8 py-4">
        {errorMsg && (
          <div className="mb-4 px-3.5 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {tab === 'dispatch' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#F0F2F5] flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-gray-700 uppercase tracking-wide">
                Scheduled today · {todayName}
              </h2>
              <span className="text-[11px] text-gray-400">
                {dispatchList.length} scheduled today
              </span>
            </div>

            {dispatchList.length === 0 ? (
              <div className="py-16 text-center">
                <div className="text-3xl mb-2">🎉</div>
                <p className="text-gray-500 text-sm font-medium">No customers scheduled for delivery today</p>
                <p className="text-gray-400 text-xs mt-1">
                  Active, non-paused customers with paid credits or grace remaining appear here once per day.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#F5F5F5]">

                {dispatchList.map(c => {
                  const used = c.used_credits || 0;
                  const total = c.total_tiffin_credits || 0;
                  const remaining = Math.max(0, total - used);
                  return (
                    <li key={c.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-[#11142D] capitalize truncate">{c.full_name}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${tierBadge[c.plan_tier || 'weekly']}`}>
                            {planTier(c.plan_tier)}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {remaining} credit{remaining === 1 ? '' : 's'} left of {total}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={busyId === c.id}
                          onClick={() => {
                            setBusyId(c.id);
                            run(() => markDelivered(c.id));
                          }}
                          className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
                        >
                          {busyId === c.id ? 'Saving…' : '✓ Mark Delivered'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === c.id}
                          onClick={() => {
                            setBusyId(c.id);
                            run(() => logSkip(c.id));
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          ⏭ Log Skip
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {completedList.length > 0 && (
              <div className="border-t border-[#F0F2F5]">
                <div className="px-5 py-3 border-b border-[#F0F2F5] flex items-center justify-between">
                  <h3 className="text-[12.5px] font-bold text-gray-700 uppercase tracking-wide">
                    ✓ Completed Today
                  </h3>
                  <span className="text-[11px] text-gray-400">
                    Undo reverses the credit/skip and re-queues today&apos;s delivery
                  </span>
                </div>
                <ul className="divide-y divide-[#F5F5F5]">
                  {completedList.map(({ customerId, event, customer: c }) => (
                    <li key={customerId} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-[13.5px] font-bold text-[#11142D] capitalize truncate">
                          {c.full_name}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${tierBadge[c.plan_tier || 'weekly']}`}>
                          {planTier(c.plan_tier)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase ${
                            event === 'delivered' ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {event === 'delivered' ? '✓ Delivered' : '⏭ Skipped'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === customerId}
                        onClick={() => {
                          setBusyId(customerId);
                          run(() => undoTodayDispatchAction(customerId));
                        }}
                        className="text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors shrink-0"
                      >
                        {busyId === customerId ? 'Undoing…' : '↩ Undo'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'ledger' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#F0F2F5] flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-gray-700 uppercase tracking-wide">Subscription Ledger</h2>
              <span className="text-[11px] text-gray-400">Click renew to reset the credit cycle</span>
            </div>

            {renewedAt && (
              <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-100 text-emerald-700 text-xs font-semibold">
                Plan renewed for {customers.find(c => c.id === renewedAt.id)?.full_name ?? 'customer'}.
              </div>
            )}

            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[#A2A4B0] font-bold uppercase text-[10.5px] tracking-wider bg-gray-50/60 h-10 border-b border-[#F0F2F5]">
                  <th className="pl-5">Customer</th>
                  <th className="px-3">Plan Tier</th>
                  <th className="px-3 w-[30%]">Credits Used</th>
                  <th className="px-3">Skipped</th>
                  <th className="pr-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F5F5]">
                {ledgerList.map(c => {
                  const used = c.used_credits || 0;
                  const total = c.total_tiffin_credits || 0;
                  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
                  const status = (c.subscription_status || 'active').toLowerCase();
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">

                      <td className="pl-5 py-3 font-semibold text-[#11142D] capitalize">{c.full_name}</td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${tierBadge[c.plan_tier || 'weekly']}`}>
                          {planTier(c.plan_tier)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#5D5FEF] transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-gray-600 whitespace-nowrap w-14 text-right">
                            {used}/{total}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-gray-600">{c.skipped_days_count || 0}</td>
                      <td className="pr-5 py-3 text-right">
                        {status === 'expired' ? (
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => {
                              setBusyId(c.id);
                              setRenewedAt({ id: c.id, at: new Date().toISOString() });
                              run(() => renewPlan(c.id));
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-[#5D5FEF] hover:bg-[#4D4FDF] rounded-lg shadow-sm disabled:opacity-50 transition-colors"
                          >
                            {busyId === c.id ? 'Renewing…' : 'Renew Plan'}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase ${
                              status === 'paused' ? 'text-amber-600' : 'text-emerald-600'
                            }`}
                          >
                            <span className={`inline-block w-2 h-2 rounded-full ${status === 'paused' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                            {status}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {ledgerList.length === 0 && (
              <div className="py-16 text-center text-gray-400 text-sm">No subscription customers found.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
