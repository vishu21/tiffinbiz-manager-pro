'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { recordCustomerPayment } from '@/app/admin/actions';
import {
  calculateStandardPlanPrice,
  calculateCycleTargetLastDay,
  resolveDeliveryDayNumbers,
  toLocalDateKey,
} from '@/app/utils/subscriptionCycle';

export type PaymentCustomer = {
  id: string;
  full_name: string;
  phone_number?: string | null;
  plan_tier?: string | null;
  total_tiffin_credits?: number | null;
  used_credits?: number | null;
  meal_type?: string | null;
  portion_size?: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  start_date?: string | null;
  cycle_end_date?: string | null;
  delivery_schedule?: string | null;
};

interface RecordPaymentModalProps {
  customer: PaymentCustomer | null;
  onClose: () => void;
  onSuccess: (payment: any) => void;
  closuresSet?: Set<string>;
  skipsMap?: Map<string, Set<string>>;
}

const formatShortLastDay = (dateKey: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function RecordPaymentModal({
  customer,
  onClose,
  onSuccess,
  closuresSet: propClosures,
  skipsMap: propSkips,
}: RecordPaymentModalProps) {
  if (!customer) return null;

  // Internal closure and skip states to guarantee holiday calculation everywhere
  const [internalClosures, setInternalClosures] = useState<Set<string>>(propClosures || new Set());
  const [internalSkips, setInternalSkips] = useState<Map<string, Set<string>>>(propSkips || new Map());

  useEffect(() => {
    if (propClosures) setInternalClosures(propClosures);
    if (propSkips) setInternalSkips(propSkips);

    if (!propClosures || !propSkips) {
      (async () => {
        try {
          const { createClient } = await import('@/utils/supabase/client');
          const supabase = createClient();
          const [closuresRes, skipsRes] = await Promise.all([
            !propClosures ? supabase.from('kitchen_closures').select('closure_date') : Promise.resolve({ data: null }),
            !propSkips
              ? supabase
                  .from('customer_daily_overrides')
                  .select('customer_id, override_date')
                  .eq('is_skipped', true)
              : Promise.resolve({ data: null }),
          ]);

          if (closuresRes.data) {
            setInternalClosures(new Set(closuresRes.data.map((c: any) => c.closure_date)));
          }
          if (skipsRes.data) {
            const map = new Map<string, Set<string>>();
            skipsRes.data.forEach((row: any) => {
              const cId = String(row.customer_id);
              const sDate = String(row.override_date || '').slice(0, 10);
              if (cId && sDate) {
                if (!map.has(cId)) map.set(cId, new Set());
                map.get(cId)!.add(sDate);
              }
            });
            setInternalSkips(map);
          }
        } catch (err) {
          console.error('[RecordPaymentModal] Failed to fetch closures/skips:', err);
        }
      })();
    }
  }, [propClosures, propSkips]);

  const tier = (customer.plan_tier || 'monthly').toLowerCase() as 'trial' | 'weekly' | 'monthly';
  // Canonical plan tier capacity: Monthly = 20, Weekly = 5, Trial = 1
  const targetCredits = tier === 'weekly' ? 5 : tier === 'trial' ? 1 : 20;
  const totalTiffinCredits = targetCredits;
  const usedCredits = customer.used_credits ?? 0;
  const isRenewing = usedCredits >= totalTiffinCredits;

  const standardBaseRate = calculateStandardPlanPrice(
    customer.meal_type,
    customer.portion_size,
    tier,
    targetCredits
  );

  let discountDeduction = 0;
  if (customer.discount_type === 'flat') {
    discountDeduction = Number(customer.discount_value) || 0;
  } else if (customer.discount_type === 'percent') {
    discountDeduction = Math.round((standardBaseRate * (Number(customer.discount_value) || 0)) / 100);
  }
  const defaultAmount = String(Math.max(0, standardBaseRate - discountDeduction));

  const [paymentAmount, setPaymentAmount] = useState(defaultAmount);
  const [paymentMethod, setPaymentMethod] = useState<'etransfer' | 'cash' | 'card' | 'other'>('etransfer');
  const [paymentPaidAt, setPaymentPaidAt] = useState(() => toLocalDateKey(new Date()));
  const [paymentCredits, setPaymentCredits] = useState<number>(targetCredits);
  const [paymentCycleAction, setPaymentCycleAction] = useState<'settle_current' | 'renew_next' | 'historical' | 'topup'>(
    isRenewing ? 'renew_next' : 'settle_current'
  );

  const initialCycleStart = useMemo(() => {
    if (isRenewing && customer.cycle_end_date) {
      const nextStart = new Date(`${customer.cycle_end_date.slice(0, 10)}T12:00:00`);
      nextStart.setDate(nextStart.getDate() + 1);
      return toLocalDateKey(nextStart);
    }
    return customer.start_date?.slice(0, 10) || toLocalDateKey(new Date());
  }, [isRenewing, customer]);

  const [paymentCycleStart, setPaymentCycleStart] = useState(initialCycleStart);
  const [paymentRefNote, setPaymentRefNote] = useState('');
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(Boolean(customer.phone_number));
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const paymentComputedEndResult = useMemo(() => {
    if (!paymentCycleStart || !paymentCredits) return null;
    const custDays = resolveDeliveryDayNumbers(customer.delivery_schedule);
    const skips = internalSkips.get(customer.id);

    return calculateCycleTargetLastDay({
      startDate: paymentCycleStart,
      totalMeals: paymentCredits,
      deliveryDays: custDays,
      closureDates: internalClosures,
      customerSkips: skips,
    });
  }, [customer, paymentCycleStart, paymentCredits, internalClosures, internalSkips]);

  const paymentComputedEndDate = paymentComputedEndResult?.dateKey || null;

  const handleConfirm = async () => {
    if (!paymentAmount) return;
    setIsRecordingPayment(true);
    try {
      const res = await recordCustomerPayment({
        customerId: customer.id,
        amount: Number(paymentAmount),
        paymentMethod,
        paidAt: paymentPaidAt,
        creditsAdded: paymentCredits,
        cycleAction: paymentCycleAction,
        referenceNote: paymentRefNote.trim() || null,
        billingCycleStart: paymentCycleStart || null,
        billingCycleEnd: paymentComputedEndDate || null,
        markStatusAs: paymentCycleAction === 'historical' ? undefined : 'paid',
      });

      if (res.success && res.payment) {
        if (sendWhatsAppReceipt && customer.phone_number) {
          const cleanDigits = customer.phone_number.replace(/[^0-9]/g, '');
          const cycleDatesStr =
            paymentCycleStart && paymentComputedEndDate
              ? ` for period (${paymentCycleStart} to ${paymentComputedEndDate})`
              : '';
          const message = `Hi ${customer.full_name}, we have received your payment of $${Number(paymentAmount).toFixed(
            2
          )} CAD via ${paymentMethod.toUpperCase()}${cycleDatesStr} covering ${paymentCredits} meals. Your balance is now settled. Thank you for choosing TiffinOS!`;
          window.open(`https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`, '_blank');
        }
        onSuccess(res.payment);
        onClose();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to record payment');
    } finally {
      setIsRecordingPayment(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg pointer-events-auto p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-base font-black text-gray-900 tracking-tight">Record Customer Payment</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mt-0.5">
                <span className="font-bold text-gray-800 capitalize">{customer.full_name}</span>
                <span>•</span>
                <span className="uppercase text-indigo-600 font-bold">{customer.plan_tier || 'Monthly'}</span>
                <span>•</span>
                <span>{usedCredits}/{totalTiffinCredits} Delivered</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {usedCredits > totalTiffinCredits && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>
                Customer has consumed <strong>{usedCredits - totalTiffinCredits} grace meals</strong>. Renewing will roll them forward starting at <strong>{usedCredits - totalTiffinCredits}/{paymentCredits}</strong>.
              </span>
            </div>
          )}

          <div className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                Payment Applies To
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: 'settle_current', label: 'Current Cycle', desc: 'Mark active as paid' },
                  { key: 'renew_next', label: 'Next Cycle', desc: 'Renew & reset' },
                  { key: 'historical', label: 'Past / Old Cycle', desc: 'Log previous payment' },
                  { key: 'topup', label: 'Top-Up Only', desc: 'Add credits' },
                ].map((act) => (
                  <button
                    key={act.key}
                    type="button"
                    onClick={() => {
                      setPaymentCycleAction(act.key as any);
                      if (act.key === 'historical' && !paymentRefNote) {
                        setPaymentRefNote('Previous cycle payment');
                      }
                    }}
                    className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                      paymentCycleAction === act.key
                        ? 'bg-indigo-50/80 border-[#5D5FEF] text-indigo-900 shadow-2xs ring-1 ring-[#5D5FEF]'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block text-xs font-bold leading-tight">{act.label}</span>
                    <span className="block text-[9.5px] text-gray-400 mt-0.5 leading-tight">{act.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Amount ($ CAD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="e.g. 220.00"
                  className="w-full text-base font-bold px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Date Money Received
                </label>
                <input
                  type="date"
                  value={paymentPaidAt}
                  onChange={(e) => setPaymentPaidAt(e.target.value)}
                  className="w-full text-xs font-bold px-3 py-2.5 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Credits Covered
                </label>
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden h-10 bg-white">
                  <button
                    type="button"
                    onClick={() => setPaymentCredits((p) => Math.max(1, p - 1))}
                    className="w-8 h-full bg-gray-50 hover:bg-gray-100 font-bold border-r border-gray-200 text-gray-600 cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={paymentCredits}
                    onChange={(e) => setPaymentCredits(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full text-center font-bold text-sm text-gray-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPaymentCredits((p) => p + 1)}
                    className="w-8 h-full bg-gray-50 hover:bg-gray-100 font-bold border-l border-gray-200 text-gray-600 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                    Cycle Start Date
                  </label>
                  <input
                    type="date"
                    value={paymentCycleStart}
                    onChange={(e) => setPaymentCycleStart(e.target.value)}
                    className="w-full text-xs font-bold px-3 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800 shadow-2xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                      Projected End
                    </label>
                    <span className="text-[9.5px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100 uppercase">
                      Auto
                    </span>
                  </div>
                  <div className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between text-xs font-bold text-gray-800 shadow-2xs">
                    <span>{paymentComputedEndDate ? formatShortLastDay(paymentComputedEndDate) : '—'}</span>
                    <span className="text-[10.5px] text-gray-400 font-semibold">{paymentComputedEndDate || 'Set start date'}</span>
                  </div>
                </div>
              </div>

              {paymentComputedEndResult &&
                (paymentComputedEndResult.holidayDaysSkipped > 0 || paymentComputedEndResult.customerDaysSkipped > 0) && (
                  <div className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    <span>📅</span>
                    <span className="flex-1">
                      Extended by <strong>+{paymentComputedEndResult.holidayDaysSkipped + paymentComputedEndResult.customerDaysSkipped} days</strong>
                      {paymentComputedEndResult.customerDaysSkipped > 0 &&
                        ` (${paymentComputedEndResult.customerDaysSkipped} customer skip${
                          paymentComputedEndResult.customerDaysSkipped > 1 ? 's' : ''
                        })`}
                      {paymentComputedEndResult.holidayDaysSkipped > 0 &&
                        ` (${paymentComputedEndResult.holidayDaysSkipped} holiday closure${
                          paymentComputedEndResult.holidayDaysSkipped > 1 ? 's' : ''
                        })`}.
                    </span>
                  </div>
                )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Payment Method
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['etransfer', 'cash', 'card', 'other'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all uppercase cursor-pointer ${
                      paymentMethod === method
                        ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-xs'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Reference / Confirmation Note (Optional)
              </label>
              <input
                type="text"
                value={paymentRefNote}
                onChange={(e) => setPaymentRefNote(e.target.value)}
                placeholder="e.g. Interac Ref #391823, Cash collected by driver"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800"
              />
            </div>

            {customer.phone_number && (
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-emerald-100 bg-emerald-50/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendWhatsAppReceipt}
                  onChange={(e) => setSendWhatsAppReceipt(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-emerald-900 block">Open WhatsApp Receipt on Confirm</span>
                  <span className="text-emerald-700 text-[10.5px]">Pre-fills a payment confirmation text to {customer.phone_number}</span>
                </div>
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 text-gray-600 font-bold rounded-xl text-xs hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isRecordingPayment || !paymentAmount}
              onClick={handleConfirm}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              {isRecordingPayment ? 'Recording...' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}