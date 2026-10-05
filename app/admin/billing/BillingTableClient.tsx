'use client';

import React, { useState, useTransition } from 'react';
import { Search, MessageSquare, CreditCard, X, Check } from 'lucide-react';
import { recordCustomerPayment } from '@/app/admin/actions';
import { calculateStandardPlanPrice } from '@/app/utils/subscriptionCycle';

export default function BillingTableClient({
  initialCustomers,
  recentPayments,
}: {
  initialCustomers: any[];
  recentPayments: any[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'overdue' | 'paid'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Modal form states
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'etransfer' | 'cash' | 'card' | 'other'>('etransfer');
  const [paymentCredits, setPaymentCredits] = useState<number>(20);
  const [paymentRefNote, setPaymentRefNote] = useState('');
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(false);
  const [isPending, startTransition] = useTransition();

  const filtered = initialCustomers.filter((c) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone_number || '').toLowerCase().includes(q) ||
      (c.delivery_address || '').toLowerCase().includes(q);

    const customerHasPayments = recentPayments.some(p => p.customer_id === c.id);
    const used = c.used_credits ?? 0;
    const total = c.total_tiffin_credits ?? 20;

    const calculatedStatus = !customerHasPayments
      ? (used > total ? 'overdue' : 'due')
      : (c.payment_status === 'paid' ? 'paid' : used > total ? 'overdue' : 'due');

    if (statusFilter !== 'all' && calculatedStatus !== statusFilter) return false;
    return matchesSearch;
  });

  const handleOpenPaymentModal = (customer: any) => {
    setSelectedCustomer(customer);
    const tier = (customer.plan_tier || 'monthly').toLowerCase();
    const credits = customer.total_tiffin_credits || (tier === 'weekly' ? 5 : tier === 'trial' ? 1 : 20);

    // Dynamic standard price based on Meal Type, Portion Size, and Tier
    const standardRate = calculateStandardPlanPrice(
      customer.meal_type,
      customer.portion_size,
      tier as 'trial' | 'weekly' | 'monthly',
      credits
    );

    let discountDeduction = 0;
    if (customer.discount_type === 'flat') {
      discountDeduction = Number(customer.discount_value) || 0;
    } else if (customer.discount_type === 'percent') {
      discountDeduction = Math.round((standardRate * (Number(customer.discount_value) || 0)) / 100);
    }

    setPaymentAmount(String(Math.max(0, standardRate - discountDeduction)));
    setPaymentMethod('etransfer');
    setPaymentCredits(credits);
    setPaymentRefNote('');
    setSendWhatsAppReceipt(Boolean(customer.phone_number));
  };

  const handleConfirmPayment = () => {
    if (!selectedCustomer || !paymentAmount) return;

    startTransition(async () => {
      try {
        const res = await recordCustomerPayment({
          customerId: selectedCustomer.id,
          amount: Number(paymentAmount),
          paymentMethod,
          creditsAdded: paymentCredits,
          cycleAction: (selectedCustomer.used_credits ?? 0) >= (selectedCustomer.total_tiffin_credits ?? 20) ? 'renew_next' : 'settle_current',
          referenceNote: paymentRefNote.trim() || null,
          billingCycleStart: selectedCustomer.start_date || null,
          billingCycleEnd: selectedCustomer.cycle_end_date || null,
          markStatusAs: 'paid',
        });

        if (res.success) {
          if (sendWhatsAppReceipt && selectedCustomer.phone_number) {
            const cleanDigits = selectedCustomer.phone_number.replace(/[^0-9]/g, '');
            const message = `Hi ${selectedCustomer.full_name}, we have received your payment of $${Number(paymentAmount).toFixed(2)} CAD via ${paymentMethod.toUpperCase()} covering ${paymentCredits} meals. Your balance is now settled. Thank you for choosing TiffinOS!`;
            window.open(`https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`, '_blank');
          }
          setSelectedCustomer(null);
        }
      } catch (err: any) {
        alert(err.message || 'Failed to record payment');
      }
    });
  };

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
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs font-semibold pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] focus:bg-white text-gray-900 transition-all"
          />
        </div>

        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200/80">
          {(['all', 'due', 'overdue', 'paid'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                statusFilter === tab
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
                const customerHasPayments = recentPayments.some(p => p.customer_id === c.id);
                const isPaid = customerHasPayments && c.payment_status === 'paid';
                const isOverdue = used > total;
                const status = isPaid ? 'paid' : isOverdue ? 'overdue' : 'due';

                const cleanPhone = (c.phone_number || '').replace(/[^0-9]/g, '');
                const whatsappReminderLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                  `Hi ${c.full_name}, your${c.plan_tier || 'Monthly'} tiffin cycle renewal payment is due. Outstanding balance: Please send Interac e-Transfer to payments@tiffin.ca. Thank you!`
                )}`;

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
                      {c.cycle_end_date ? c.cycle_end_date.slice(0, 10) : '—'}
                    </td>

                    <td className="py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                          status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : status === 'overdue'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {status}
                      </span>
                    </td>

                    <td className="pr-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {cleanPhone && !isPaid && (
                          <a
                            href={whatsappReminderLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ping WhatsApp Reminder"
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenPaymentModal(c)}
                          className="px-2.5 py-1 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white rounded-lg font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
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

      {/* ── MODAL ── */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-black text-sm text-gray-900">
                  Log Payment for {selectedCustomer.full_name}
                </h3>
                <p className="text-xs text-gray-500 font-medium capitalize">
                  {selectedCustomer.plan_tier || 'Monthly'} • {selectedCustomer.used_credits ?? 0}/{selectedCustomer.total_tiffin_credits ?? 20} Delivered
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Amount Received ($ CAD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full font-bold text-base px-3.5 py-2 border rounded-xl outline-none focus:border-[#5D5FEF]"
                />
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
                          ? 'bg-[#5D5FEF] text-white border-[#5D5FEF]'
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
                  Credits (Meals Covered)
                </label>
                <input
                  type="number"
                  min="1"
                  value={paymentCredits}
                  onChange={(e) => setPaymentCredits(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full font-bold text-sm px-3.5 py-2 border rounded-xl outline-none focus:border-[#5D5FEF]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Reference Note (Optional)
                </label>
                <input
                  type="text"
                  value={paymentRefNote}
                  onChange={(e) => setPaymentRefNote(e.target.value)}
                  placeholder="e.g. Interac Ref #391823"
                  className="w-full text-xs font-semibold px-3.5 py-2 border rounded-xl outline-none focus:border-[#5D5FEF]"
                />
              </div>

              {selectedCustomer.phone_number && (
                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-100 bg-emerald-50/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendWhatsAppReceipt}
                    onChange={(e) => setSendWhatsAppReceipt(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-emerald-900 block">Open WhatsApp Receipt</span>
                    <span className="text-emerald-700 text-[10.5px]">Pre-fills confirmation text to {selectedCustomer.phone_number}</span>
                  </div>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="px-4 py-2 border rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending || !paymentAmount}
                onClick={handleConfirmPayment}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {isPending ? 'Recording...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}