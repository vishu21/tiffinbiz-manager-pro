'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, X, Copy, Send, Check, ChevronDown } from 'lucide-react';
import { cleanPhoneNumberForWhatsApp } from '@/app/utils/mealEngine';
import type { CustomTemplate } from '@/app/admin/settings/actions';

const FALLBACK_CUSTOMER_PRESETS: CustomTemplate[] = [
  {
    id: 'pricing_veg',
    title: 'Veg Plans & Pricing',
    tag: 'VEG-PRICING',
    is_pinned: true,
    template: 'Hello {customer_name}! Here are our Vegetarian Tiffin plans:\n\n{veg_pricing}\n\n_• Mon–Fri fresh delivery before 9:00 AM._\n_• Fresh rotis included daily (rice substitute optional)._\n\nWhich portion size (Regular or Large) would you like to start with?',
  },
  {
    id: 'pricing_nonveg',
    title: 'Non-Veg Plans & Pricing',
    tag: 'NV-PRICING',
    is_pinned: true,
    template: 'Hello {customer_name}! Here are our Non-Veg Tiffin plans:\n\n{nonveg_pricing}\n\n_• Mon–Fri fresh delivery before 9:00 AM._\n_• Fresh rotis included daily (rice substitute optional)._\n\nWould you like to try a 1-day Trial, 1-week, or full Monthly plan?',
  },
  {
    id: 'pricing_full',
    title: 'Full Menu & Pricing (Both)',
    tag: 'FULL-PRICING',
    is_pinned: true,
    template: 'Hello {customer_name}! Here is our complete Tiffin plan & pricing guide:\n\n{pricing_sheet}\n\nLet us know your delivery address and preferred plan to check route availability!',
  },
  {
    id: 'meals_remaining',
    title: 'Meals Remaining',
    tag: 'INQUIRY',
    is_pinned: false,
    template: 'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your cycle.',
  },
  {
    id: 'cycle_end',
    title: 'Cycle End Date',
    tag: 'SCHEDULE',
    is_pinned: false,
    template: 'Hi {customer_name}, your current delivery cycle runs until {cycle_end_date}.',
  },
  {
    id: 'balance_summary',
    title: 'Full Balance Summary (Billing Due)',
    tag: 'BILLING DUE',
    is_pinned: false,
    template: 'Hi {customer_name}, this is your balance summary: ${amount} CAD is due for {cycle_dates} ({remaining_meals} meals left). Please send Interac e-Transfer to {payment_email}. Thank you!',
  },
  {
    id: 'renewal',
    title: 'Cycle Renewal Notice',
    tag: 'RENEWAL',
    is_pinned: false,
    template: 'Hi {customer_name}, your {plan_tier} plan ends on {cycle_end_date}. Please let us know if you would like to renew or make adjustments for next cycle. Thank you!',
  },
];

export type CustomerMessageTarget = {
  id: string;
  full_name: string;
  phone_number?: string | null;
  start_date?: string | null;
  remaining_meals?: number;
  total_credits?: number;
  cycle_end_date?: string | null;
  cycle_dates?: string | null;
  amount?: number | string;
  plan_tier?: string | null;
  payment_email?: string;
};

interface CustomerMessageModalProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerMessageTarget | null;
  initialPresetId?: string;
}

export default function CustomerMessageModal({
  open,
  onClose,
  customer,
  initialPresetId,
}: CustomerMessageModalProps) {
  const [presets, setPresets] = useState<CustomTemplate[]>(FALLBACK_CUSTOMER_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [defaultPaymentEmail, setDefaultPaymentEmail] = useState<string>('payments@tiffin.ca');
  const [messageText, setMessageText] = useState('');
  const [copied, setCopied] = useState(false);

  // Load dynamic presets and configured payment email from Supabase
  useEffect(() => {
    let isCurrent = true;
    (async () => {
      try {
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();
        const { data } = await supabase
          .from('app_settings')
          .select('customer_message_templates, payment_email')
          .eq('id', 'default')
          .maybeSingle();

        if (isCurrent && data) {
          if (data.payment_email) {
            setDefaultPaymentEmail(data.payment_email);
          }
          if (
            data.customer_message_templates &&
            Array.isArray(data.customer_message_templates) &&
            data.customer_message_templates.length > 0
          ) {
            setPresets(data.customer_message_templates);
          }
        }
      } catch (err) {
        console.error('[CustomerMessageModal] Failed to load presets & payment email:', err);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, []);

  // Compute top 3 quick pills vs overflow dropdown items
  const pinnedList = presets.filter(p => p.is_pinned);
  const quickPills = (pinnedList.length > 0 ? pinnedList : presets).slice(0, 3);
  const dropdownItems = presets.filter(p => !quickPills.some(q => q.id === p.id));
  const isDropdownActive = dropdownItems.some(d => d.id === activePresetId);
  const activeDropdownPreset = dropdownItems.find(d => d.id === activePresetId);

  // Initialize selected preset
  useEffect(() => {
    if (presets.length > 0) {
      if (initialPresetId && presets.some(p => p.id === initialPresetId)) {
        setActivePresetId(initialPresetId);
      } else if (quickPills.length > 0) {
        setActivePresetId(quickPills[0].id);
      } else {
        setActivePresetId(presets[0].id);
      }
    }
  }, [open, initialPresetId, presets]);

  const formatShortDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const clean = dateStr.slice(0, 10);
    const d = new Date(`${clean}T12:00:00`);
    if (isNaN(d.getTime())) return clean;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const resolveCycleDates = (): string => {
    if (customer?.cycle_dates && customer.cycle_dates.trim() !== '' && customer.cycle_dates.includes('→')) {
      return customer.cycle_dates;
    }
    const startFormatted = formatShortDate(customer?.start_date);
    const endFormatted = formatShortDate(customer?.cycle_end_date);

    if (startFormatted && endFormatted) {
      return `${startFormatted} → ${endFormatted}`;
    }
    if (endFormatted) {
      return endFormatted;
    }
    return customer?.cycle_dates || 'Current Cycle';
  };

  const compile = (templateStr: string) => {
    if (!customer) return '';

    const vegPricing =
`🥗 *Vegetarian Plans:*
• *Regular (8oz):* $13 Daily | $60 Weekly (5) | $220 Monthly (20)
  _1 Dal + 1 Sabji + 6 Roti_
• *Large (12oz):* $15 Daily | $70 Weekly (5) | $250 Monthly (20)
  _1 Dal + 1 Sabji + Salad + 8 Roti + Weekly Dessert_`;

    const nonVegPricing =
`🍗 *Non-Vegetarian Plans:*
_(Chicken Curry Mon/Wed/Fri • Veg Sabji Tue/Thu)_
• *Regular (8oz):* $15 Daily | $70 Weekly (5) | $250 Monthly (20)
  _Chicken/Sabji + 1 Dal + 6 Roti_
• *Large (12oz):* $17 Daily | $80 Weekly (5) | $280 Monthly (20)
  _Chicken/Sabji + 1 Dal + 8 Roti + Salad + Weekly Dessert_`;

    const fullPricing = `${vegPricing}\n\n${nonVegPricing}\n\n_• Deliveries Mon–Fri before 9:00 AM._\n_• Fresh rotis daily (rice substitute optional)._`;

    return templateStr
      .replace(/{customer_name}/g, customer.full_name || '')
      .replace(/{veg_pricing}/g, vegPricing)
      .replace(/{nonveg_pricing}/g, nonVegPricing)
      .replace(/{pricing_sheet}/g, fullPricing)
      .replace(/{remaining_meals}/g, String(customer.remaining_meals ?? 0))
      .replace(/{total_credits}/g, String(customer.total_credits ?? 20))
      .replace(/{cycle_end_date}/g, customer.cycle_end_date || '—')
      .replace(/{cycle_dates}/g, resolveCycleDates())
      .replace(/{amount}/g, typeof customer.amount === 'number' ? customer.amount.toFixed(2) : String(customer.amount || '250.00'))
      .replace(/{plan_tier}/g, customer.plan_tier || 'Monthly')
      .replace(/{payment_email}/g, customer.payment_email || defaultPaymentEmail);
  };

  useEffect(() => {
    if (!customer || !open || presets.length === 0) return;
    const current = presets.find(p => p.id === activePresetId) || presets[0];
    if (current) {
      setMessageText(compile(current.template));
    }
  }, [customer, open, activePresetId, presets, defaultPaymentEmail]);

  if (!open || !customer) return null;

  const cleanPhone = cleanPhoneNumberForWhatsApp(customer.phone_number);

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendWhatsApp = () => {
    if (!cleanPhone) return;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#00D1B2]/10 text-[#00D1B2] flex items-center justify-center font-bold">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 tracking-tight">Send Customer Update</h3>
              <p className="text-[11.5px] text-slate-500 font-semibold">
                To <strong className="text-slate-800 capitalize">{customer.full_name}</strong> ({customer.phone_number || 'No phone'})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-black uppercase text-slate-400 tracking-wider">
                Select Message Preset
              </label>
              {isDropdownActive && activeDropdownPreset && (
                <span className="text-[10.5px] font-bold text-[#00D1B2] bg-[#00D1B2]/10 px-2 py-0.5 rounded-full">
                  ✓ Active: {activeDropdownPreset.title}
                </span>
              )}
            </div>

            {/* Top 3 Quick Pills + Overflow Dropdown */}
            <div className="flex flex-wrap items-center gap-1.5">
              {quickPills.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setActivePresetId(preset.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activePresetId === preset.id
                      ? 'bg-[#00D1B2] text-white border-[#00D1B2] shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span>{preset.title}</span>
                  {preset.tag && (
                    <span
                      className={`text-[9px] px-1 rounded uppercase font-black ${
                        activePresetId === preset.id
                          ? 'bg-black/20 text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {preset.tag}
                    </span>
                  )}
                </button>
              ))}

              {/* Overflow Dropdown for other templates */}
              {dropdownItems.length > 0 && (
                <div className="relative">
                  <select
                    value={isDropdownActive ? activePresetId : ''}
                    onChange={(e) => setActivePresetId(e.target.value)}
                    className={`h-[30px] pl-3 pr-7 rounded-xl text-xs font-bold border transition-all cursor-pointer appearance-none outline-none ${
                      isDropdownActive
                        ? 'bg-[#00D1B2] text-white border-[#00D1B2] shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <option value="" disabled className="text-slate-400 bg-white">
                      ▾ More Templates ({dropdownItems.length})
                    </option>
                    {dropdownItems.map((preset) => (
                      <option key={preset.id} value={preset.id} className="text-slate-800 bg-white font-medium">
                        {preset.title} {preset.tag ? `[${preset.tag}]` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`w-3.5 h-3.5 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${
                    isDropdownActive ? 'text-white' : 'text-slate-400'
                  }`} />
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-black uppercase text-slate-400 tracking-wider">
                Message Text (Editable)
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs font-bold text-[#5D5FEF] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <textarea
              rows={7}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              className="w-full p-3 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#5D5FEF] outline-none leading-relaxed text-slate-800 resize-y max-h-64"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!cleanPhone}
            onClick={handleSendWhatsApp}
            className="px-5 py-2.5 bg-[#25D366] hover:bg-[#20bd5a] text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send via WhatsApp</span>
          </button>
        </div>

      </div>
    </div>
  );
}