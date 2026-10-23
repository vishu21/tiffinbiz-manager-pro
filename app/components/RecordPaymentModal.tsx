'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { recordCustomerPayment, updateCustomerPayment } from '@/app/admin/actions';
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
  initialPayment?: any | null;
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
  initialPayment,
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

  const isEditing = Boolean(initialPayment);

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

  const [paymentAmount, setPaymentAmount] = useState(() =>
    initialPayment ? String(initialPayment.amount) : defaultAmount
  );
  const [paymentMethod, setPaymentMethod] = useState<'etransfer' | 'cash' | 'card' | 'other'>(() =>
    initialPayment ? (initialPayment.payment_method || 'etransfer') : 'etransfer'
  );
  const [paymentPaidAt, setPaymentPaidAt] = useState(() =>
    initialPayment?.paid_at
      ? initialPayment.paid_at.slice(0, 10)
      : (initialPayment?.recorded_at ? initialPayment.recorded_at.slice(0, 10) : toLocalDateKey(new Date()))
  );
  const [paymentCredits, setPaymentCredits] = useState<number>(() =>
    initialPayment ? (initialPayment.credits_added ?? targetCredits) : targetCredits
  );
  const [paymentCycleAction, setPaymentCycleAction] = useState<'settle_current' | 'renew_next' | 'historical' | 'topup'>(() =>
    initialPayment ? (initialPayment.cycle_action || 'settle_current') : (isRenewing ? 'renew_next' : 'settle_current')
  );

  const initialCycleStart = useMemo(() => {
    if (initialPayment?.billing_cycle_start) {
      return initialPayment.billing_cycle_start.slice(0, 10);
    }
    if (isRenewing && customer.cycle_end_date) {
      const nextStart = new Date(`${customer.cycle_end_date.slice(0, 10)}T12:00:00`);
      nextStart.setDate(nextStart.getDate() + 1);
      return toLocalDateKey(nextStart);
    }
    return customer.start_date?.slice(0, 10) || toLocalDateKey(new Date());
  }, [isRenewing, customer, initialPayment]);

  const [paymentCycleStart, setPaymentCycleStart] = useState(initialCycleStart);
  const [paymentRefNote, setPaymentRefNote] = useState(() => initialPayment?.reference_note || '');
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [configuredReceiptTemplate, setConfiguredReceiptTemplate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();
        const { data } = await supabase
          .from('app_settings')
          .select('customer_message_templates')
          .single();

        if (data?.customer_message_templates && Array.isArray(data.customer_message_templates)) {
          const receiptTpl = data.customer_message_templates.find(
            (t: any) => t.id === 'payment_receipt'
          );
          if (receiptTpl?.template) {
            setConfiguredReceiptTemplate(receiptTpl.template);
          }
        }
      } catch (err) {
        console.error('[RecordPaymentModal] Error loading template:', err);
      }
    })();
  }, []);

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
      let res;
      if (isEditing && initialPayment?.id) {
        res = await updateCustomerPayment(initialPayment.id, {
          amount: Number(paymentAmount),
          paymentMethod,
          paidAt: paymentPaidAt, // <-- Pass the edited payment date!
          creditsAdded: paymentCredits,
          cycleAction: paymentCycleAction,
          billingCycleStart: paymentCycleStart || null,
          billingCycleEnd: paymentComputedEndDate || null,
          referenceNote: paymentRefNote.trim() || null,
        });
      } else {
        res = await recordCustomerPayment({
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
      }

      if (res.success && res.payment) {
        if (sendWhatsAppReceipt && customer.phone_number) {
          const cleanDigits = customer.phone_number.replace(/[^0-9]/g, '');
          const cycleDatesStr =
            paymentCycleStart && paymentComputedEndDate
              ? `${paymentCycleStart} to ${paymentComputedEndDate}`
              : 'Current Cycle';

          const defaultTemplate =
            'Hi {customer_name}, we have received your payment of {amount} CAD via {payment_method} for period ({cycle_dates}) covering {total_credits} meals. Your balance is now settled. Thank you for choosing {business_name}!';

          const rawTemplate = configuredReceiptTemplate || defaultTemplate;

          const message = rawTemplate
            .replaceAll('{customer_name}', customer.full_name)
            .replaceAll('{amount}', `$${Number(paymentAmount).toFixed(2)}`)
            .replaceAll('{payment_method}', paymentMethod.toUpperCase())
            .replaceAll('{cycle_dates}', cycleDatesStr)
            .replaceAll('{total_credits}', String(paymentCredits))
            .replaceAll('{remaining_meals}', String(paymentCredits))
            .replaceAll('{plan_tier}', customer.plan_tier || 'Monthly')
            .replaceAll('{business_name}', 'TiffinBiz');

          window.open(`https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`, '_blank');
        }
        onSuccess(res.payment);
        onClose();
      }
    } catch (err: any) {
      alert(err.message || (isEditing ? 'Failed to update payment' : 'Failed to record payment'));
    } finally {
      setIsRecordingPayment(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md pointer-events-auto p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-base font-black text-gray-900 tracking-tight">
  {isEditing ? 'Edit Payment Record' : 'Record Payment'}
</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mt-0.5">
                <span className="font-bold text-gray-800 capitalize">{customer.full_name}</span>
                <span>•</span>
                <span className="uppercase text-[#5D5FEF] font-bold">{customer.plan_tier || 'Monthly'}</span>
                <span>•</span>
                <span>{usedCredits}/{totalTiffinCredits} Delivered</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Grace Alert (Conditional) */}
          {usedCredits > totalTiffinCredits && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-2">
              <span>⚠️</span>
              <span>
                <strong>{usedCredits - totalTiffinCredits} grace meals</strong> consumed. Next cycle starts at {usedCredits - totalTiffinCredits}/{paymentCredits}.
              </span>
            </div>
          )}

          <div className="space-y-4">
            {/* 1. Sleek Segmented Cycle Action */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Applies To
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-gray-100 rounded-xl">
                {[
                  { key: 'settle_current', label: 'Current' },
                  { key: 'renew_next', label: 'Next' },
                  { key: 'historical', label: 'Past' },
                  { key: 'topup', label: 'Top-Up' },
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
                    className={`h-8 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${paymentCycleAction === act.key
                        ? 'bg-white text-gray-900 shadow-2xs'
                        : 'text-gray-500 hover:text-gray-900'
                      }`}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Amount & Payment Date (Clean 2-Col) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Amount ($ CAD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="235.00"
                    className="w-full text-sm font-bold pl-7 pr-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-900 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentPaidAt}
                  onChange={(e) => setPaymentPaidAt(e.target.value)}
                  className="w-full text-xs font-bold px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800 bg-white"
                />
              </div>
            </div>

            {/* 3. Cycle Coverage & Dates in Compact Card */}
            <div className="p-3 bg-gray-50 border border-gray-200/80 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                  Cycle Meals
                </span>
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden h-7 bg-white">
                  <button
                    type="button"
                    onClick={() => setPaymentCredits((p) => Math.max(1, p - 1))}
                    className="w-8 h-full bg-gray-50 hover:bg-gray-100 text-xs font-bold border-r border-gray-200 text-gray-600 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    −
                  </button>
                  <span className="px-2.5 text-xs font-bold text-gray-800">
                    {paymentCredits} meals
                  </span>
                  <button
                    type="button"
                    onClick={() => setPaymentCredits((p) => p + 1)}
                    className="w-8 h-full bg-gray-50 hover:bg-gray-100 text-xs font-bold border-l border-gray-200 text-gray-600 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[9.5px] font-semibold text-gray-400 uppercase mb-0.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={paymentCycleStart}
                    onChange={(e) => setPaymentCycleStart(e.target.value)}
                    className="w-full text-xs font-semibold px-2 py-1.5 bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5D5FEF] text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-[9.5px] font-semibold text-gray-400 uppercase mb-0.5">
                    Projected End
                  </label>
                  <div className="w-full py-1.5 px-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 truncate">
                    {paymentComputedEndDate ? formatShortLastDay(paymentComputedEndDate) : '—'}
                  </div>
                </div>
              </div>

              {paymentComputedEndResult &&
                (paymentComputedEndResult.holidayDaysSkipped > 0 || paymentComputedEndResult.customerDaysSkipped > 0) && (
                  <p className="text-[10.5px] text-amber-700 font-medium">
                    📅 Extended by +{paymentComputedEndResult.holidayDaysSkipped + paymentComputedEndResult.customerDaysSkipped} day(s) for closures/skips.
                  </p>
                )}
            </div>

            {/* 4. Payment Method (Clean Row) */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Payment Method
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['etransfer', 'cash', 'card', 'other'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`h-8 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 uppercase cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${paymentMethod === method
                        ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-2xs'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-2xs'
                      }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* 5. Reference Note */}
            <div>
              <input
                type="text"
                value={paymentRefNote}
                onChange={(e) => setPaymentRefNote(e.target.value)}
                placeholder="Reference / note (e.g. Interac Ref # or cash note)"
                className="w-full text-xs px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800 bg-white placeholder-gray-400"
              />
            </div>

            {/* 6. Clean WhatsApp Toggle */}
            {customer.phone_number && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendWhatsAppReceipt}
                  onChange={(e) => setSendWhatsAppReceipt(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-[#5D5FEF] focus:ring-[#5D5FEF]"
                />
                <span>Send WhatsApp receipt to <strong>{customer.phone_number}</strong></span>
              </label>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 py-2 border border-gray-200 bg-white text-gray-700 font-bold rounded-xl text-xs shadow-2xs hover:bg-gray-50 cursor-pointer transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isRecordingPayment || !paymentAmount}
              onClick={handleConfirm}
              className="h-10 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-2xs border border-transparent transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              {isRecordingPayment ? 'Saving...' : (isEditing ? 'Save Changes' : 'Confirm Payment')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}