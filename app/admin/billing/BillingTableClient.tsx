'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, MessageSquare, CreditCard } from 'lucide-react';
import RecordPaymentModal from '@/app/components/RecordPaymentModal';
import CustomerMessageModal, { type CustomerMessageTarget } from '@/app/components/CustomerMessageModal';
import {
  calculateCycleTargetLastDay,
  resolveDeliveryDayNumbers,
  computeCustomerPeriods,
  formatShortDate,
  getCustomerLiveMetrics,
  type PlanPricingMatrix,
} from '@/app/utils/subscriptionCycle';
import { cleanPhoneNumberForWhatsApp } from '@/app/utils/mealEngine';

export default function BillingTableClient({
  initialCustomers,
  recentPayments,
  initialClosures = [],
  initialSkips = [],
  pricingMatrix = null,
}: {
  initialCustomers: any[];
  recentPayments: any[];
  initialClosures?: string[];
  initialSkips?: Array<{ customerId: string; date: string }>;
  pricingMatrix?: PlanPricingMatrix | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get('search') || searchParams.get('q') || '';
  const urlCustomerId = searchParams.get('id') || '';

  const [searchTerm, setSearchTerm] = useState(urlSearch);
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'overdue' | 'paid'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [messagingTarget, setMessagingTarget] = useState<CustomerMessageTarget | null>(null);

  // Deep-link sync: Auto-filter & open Log Payment modal when navigating from Global Search
  useEffect(() => {
    setSearchTerm(urlSearch);

    if (urlCustomerId) {
      const match = initialCustomers.find(c => c.id === urlCustomerId);
      if (match) {
        setSelectedCustomer(match);
      }
    } else if (urlSearch) {
      const match = initialCustomers.find(
        c => (c.full_name || '').toLowerCase() === urlSearch.toLowerCase()
      );
      if (match) {
        setSelectedCustomer(match);
      }
    }
  }, [urlSearch, urlCustomerId, initialCustomers]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    const params = new URLSearchParams(window.location.search);
    if (val.trim()) {
      params.set('search', val.trim());
    } else {
      params.delete('search');
      params.delete('q');
      params.delete('id');
    }
    const nextQuery = params.toString();
    router.replace(`/admin/billing${nextQuery ? `?${nextQuery}` : ''}`, { scroll: false });
  };

  const closuresSet = useMemo(() => new Set(initialClosures), [initialClosures]);
  const skipsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    initialSkips.forEach(s => {
      if (!map.has(s.customerId)) map.set(s.customerId, new Set());
      map.get(s.customerId)!.add(s.date);
    });
    return map;
  }, [initialSkips]);

  // Compute live holiday-extended end dates & cycle status for every customer
  const enrichedCustomers = useMemo(() => {
    return initialCustomers.map(c => {
      const custSkips = skipsMap.get(c.id);

      // Check current cycle payment from periods tracker
      const periods = computeCustomerPeriods({
        customer: c,
        payments: recentPayments.filter(p => p.customer_id === c.id),
        closureDates: closuresSet,
        customerSkips: custSkips,
        pricingMatrix,
      });

      const currentPeriod = periods.find(p => p.index === 0);
      const isCurrentCyclePaid = currentPeriod?.isPaid ?? false;

      // Use Master Single Source of Truth
      const live = getCustomerLiveMetrics({
        customer: c,
        closuresSet,
        skipsSet: custSkips,
        isPaid: isCurrentCyclePaid,
      });

      return {
        ...c,
        dynamicEndDate: live.effectiveEndDate,
        calculatedStatus: live.status,
        deliveredMeals: live.deliveredMeals,
        remainingMeals: live.remainingMeals,
        totalMeals: live.totalMeals,
        currentPeriod,
      };
    });
  }, [initialCustomers, recentPayments, closuresSet, skipsMap, pricingMatrix]);

  const filtered = enrichedCustomers.filter(c => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone_number || '').toLowerCase().includes(q) ||
      (c.delivery_address || '').toLowerCase().includes(q);

    if (statusFilter !== 'all' && c.calculatedStatus !== statusFilter) return false;
    return matchesSearch;
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── CONTROLS STRIP ── */}
      <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search billing records..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full text-xs font-semibold pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] focus:bg-white text-gray-900 transition-all"
          />
        </div>

        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200/80">
          {(['all', 'due', 'overdue', 'paid'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`h-8 px-3 rounded-xl text-xs font-bold uppercase transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${statusFilter === tab
                  ? 'bg-white text-[#5D5FEF] shadow-2xs'
                  : 'text-gray-500 hover:text-gray-900'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── RECEIVABLES TABLE ── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full table-fixed text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-white border-b border-gray-200 uppercase text-[10.5px] font-bold text-gray-400 z-10 shadow-2xs">
            <tr>
              <th className="pl-4 py-3 w-[26%]">Customer</th>
              <th className="py-3 w-[14%]">Plan Tier</th>
              <th className="py-3 w-[16%]">Delivery Progress</th>
              <th className="py-3 w-[14%]">Cycle End</th>
              <th className="py-3 w-[14%]">Status</th>
              <th className="pr-4 py-3 text-right w-[16%]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400 font-medium">
                  No billing records match the selected filter.
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const used = c.used_credits ?? 0;
                const total = c.total_tiffin_credits ?? 20;
                const cleanPhone = cleanPhoneNumberForWhatsApp(c.phone_number);

                return (
                  <tr key={c.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="pl-4 py-3 font-bold text-gray-900 capitalize truncate">
                      <span>{c.full_name}</span>
                      {c.phone_number && (
                        <span className="block text-[11px] text-gray-400 font-normal">
                          {c.phone_number}
                        </span>
                      )}
                    </td>

                    <td className="py-3 font-bold uppercase text-indigo-600">
                      {c.plan_tier || 'Monthly'}
                    </td>

                    <td className="py-3 text-gray-600 font-medium">
                      <span className="font-bold text-gray-900">{used}</span> / {total} meals
                      {used > total && (
                        <span className="ml-1 text-[10px] text-rose-600 font-bold">
                          (+{used - total} grace)
                        </span>
                      )}
                    </td>

                    <td className="py-3 text-gray-600 font-semibold">
                      {c.dynamicEndDate ? c.dynamicEndDate : '—'}
                    </td>

                    <td className="py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${c.calculatedStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : c.calculatedStatus === 'overdue'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                      >
                        {c.calculatedStatus}
                      </span>
                    </td>

                    <td className="pr-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {cleanPhone && c.calculatedStatus !== 'paid' && (
                          <button
                            type="button"
                            onClick={() =>
                              setMessagingTarget({
                                id: c.id,
                                full_name: c.full_name,
                                phone_number: c.phone_number,
                                remaining_meals: c.remainingMeals,
                                total_credits: c.totalMeals,
                                cycle_end_date: c.dynamicEndDate,
                                cycle_dates: c.currentPeriod
                                  ? `${formatShortDate(c.currentPeriod.startDate)} → ${formatShortDate(c.currentPeriod.endDate)}`
                                  : undefined,
                                amount: c.currentPeriod?.expectedAmount ?? 250,
                                plan_tier: c.plan_tier || 'Monthly',
                              })
                            }
                            title="Edit & Send Billing Notice"
                            className="w-8 h-8 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 shadow-2xs transition-all duration-150 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="h-8 px-3 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white rounded-xl font-bold text-xs shadow-2xs border border-transparent transition-all duration-150 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>Log Payment</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── SHARED UNIFIED PAYMENT MODAL ── */}
      {selectedCustomer && (
        <RecordPaymentModal
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onSuccess={() => {
            setSelectedCustomer(null);
            router.refresh();
          }}
          closuresSet={closuresSet}
          skipsMap={skipsMap}
        />
      )}

      {/* ── SHARED UNIFIED CUSTOMER MESSAGE MODAL ── */}
      {messagingTarget && (
        <CustomerMessageModal
          open={Boolean(messagingTarget)}
          customer={messagingTarget}
          initialPresetId="balance_summary"
          onClose={() => setMessagingTarget(null)}
        />
      )}
    </div>
  );
}