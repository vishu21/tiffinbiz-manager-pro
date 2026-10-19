'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, X, Copy, Send, Check } from 'lucide-react';
import { cleanPhoneNumberForWhatsApp } from '@/app/utils/mealEngine';

export type CustomerMessageTarget = {
  id: string;
  full_name: string;
  phone_number?: string | null;
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
  initialPreset?: 'meals' | 'termProgress' | 'cycleEnd' | 'balance' | 'renewal';
}

export default function CustomerMessageModal({
  open,
  onClose,
  customer,
  initialPreset = 'balance',
}: CustomerMessageModalProps) {
  const [activePreset, setActivePreset] = useState<'meals' | 'cycleEnd' | 'balance' | 'renewal' | 'termProgress'>(initialPreset);
  const [messageText, setMessageText] = useState('');
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState({
    msg_meals_remaining: 'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your cycle.',
    msg_term_progress: 'Hi {customer_name}, you have {remaining_meals} out of {total_credits} tiffins remaining in your current {plan_tier} term ending on {cycle_end_date}.',
    msg_cycle_end: 'Hi {customer_name}, your current delivery cycle runs until {cycle_end_date}.',
    msg_balance_summary: 'Hi {customer_name}, this is your balance summary: ${amount} CAD is due for {cycle_dates} ({remaining_meals} meals left). Please send Interac e-Transfer to {payment_email}. Thank you!',
    msg_renewal: 'Hi {customer_name}, your {plan_tier} plan ends on {cycle_end_date}. Please let us know if you would like to renew or make adjustments for next cycle. Thank you!',
  });

  // Reset preset selection when modal opens
  useEffect(() => {
    if (open) {
      setActivePreset(initialPreset);
    }
  }, [open, initialPreset]);

  // Fetch real app_settings presets
  useEffect(() => {
    let isCurrent = true;
    (async () => {
      try {
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();
        const { data } = await supabase
          .from('app_settings')
          .select('msg_meals_remaining, msg_term_progress, msg_cycle_end, msg_balance_summary, msg_renewal')
          .eq('id', 'default')
          .maybeSingle();

        if (isCurrent && data) {
          setTemplates(prev => ({
            msg_meals_remaining: data.msg_meals_remaining || prev.msg_meals_remaining,
            msg_term_progress: data.msg_term_progress || prev.msg_term_progress,
            msg_cycle_end: data.msg_cycle_end || prev.msg_cycle_end,
            msg_balance_summary: data.msg_balance_summary || prev.msg_balance_summary,
            msg_renewal: data.msg_renewal || prev.msg_renewal,
          }));
        }
      } catch (err) {
        console.error('[CustomerMessageModal] Failed to load message templates:', err);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, []);

  const compile = (templateStr: string) => {
    if (!customer) return '';
    return templateStr
      .replace(/{customer_name}/g, customer.full_name || '')
      .replace(/{remaining_meals}/g, String(customer.remaining_meals ?? 0))
      .replace(/{total_credits}/g, String(customer.total_credits ?? 20))
      .replace(/{cycle_end_date}/g, customer.cycle_end_date || '—')
      .replace(/{cycle_dates}/g, customer.cycle_dates || customer.cycle_end_date || 'Current Cycle')
      .replace(/{amount}/g, typeof customer.amount === 'number' ? customer.amount.toFixed(2) : String(customer.amount || '250.00'))
      .replace(/{plan_tier}/g, customer.plan_tier || 'Monthly')
      .replace(/{payment_email}/g, customer.payment_email || 'payments@tiffin.ca');
  };

  useEffect(() => {
    if (!customer || !open) return;
    let raw = templates.msg_balance_summary;
    if (activePreset === 'meals') raw = templates.msg_meals_remaining;
    if (activePreset === 'termProgress') raw = templates.msg_term_progress;
    if (activePreset === 'cycleEnd') raw = templates.msg_cycle_end;
    if (activePreset === 'renewal') raw = templates.msg_renewal;

    setMessageText(compile(raw));
  }, [customer, open, activePreset, templates]);

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
            <label className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
              Select Inquiry / Message Template
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'meals' as const, label: '🍱 Meals Remaining' },
                { key: 'termProgress' as const, label: '📊 Term Progress' },
                { key: 'cycleEnd' as const, label: '📅 Cycle End Date' },
                { key: 'balance' as const, label: '💳 Full Balance Summary' },
                { key: 'renewal' as const, label: '⏳ Renewal Notice' },
              ].map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setActivePreset(preset.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    activePreset === preset.key
                      ? 'bg-[#00D1B2] text-white border-[#00D1B2] shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
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
              rows={5}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              className="w-full p-3 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#5D5FEF] outline-none leading-relaxed text-slate-800"
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