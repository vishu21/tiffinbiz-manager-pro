'use client';

import { useState, useTransition, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Plus, Trash2, Truck, MessageSquare, Star } from 'lucide-react';
import { saveAppSettings, type AppSettingsPayload, type CustomTemplate } from '../actions';
import { useToast } from '@/app/components/ToastProvider';

const DEFAULT_CLIENT_PRESETS: CustomTemplate[] = [
  {
    id: 'payment_receipt',
    title: 'Payment Confirmation Receipt',
    tag: 'RECEIPT',
    is_pinned: false,
    template: 'Hi {customer_name}, we have received your payment of {amount} CAD via {payment_method} for period ({cycle_dates}) covering {total_credits} meals. Your balance is now settled. Thank you for choosing {business_name}!',
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
    is_pinned: true,
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
  {
    id: 'term_progress',
    title: 'Term Tiffins Remaining',
    tag: 'TERM PROGRESS',
    is_pinned: false,
    template: 'Hi {customer_name}, you have {remaining_meals} out of {total_credits} tiffins remaining in your current {plan_tier} term ending on {cycle_end_date}.',
  },
];

export default function MessagingSettingsClient({
  initialSettings,
}: {
  initialSettings: AppSettingsPayload;
}) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  // Normalize loaded templates: if no preset is pinned yet, pin the first 3
  const normalizedCustomerTemplates: CustomTemplate[] = (() => {
    const raw =
      Array.isArray(initialSettings.customer_message_templates) &&
        initialSettings.customer_message_templates.length > 0
        ? initialSettings.customer_message_templates
        : DEFAULT_CLIENT_PRESETS;

    const hasAnyPinned = raw.some((t: CustomTemplate) => Boolean(t.is_pinned));
    if (!hasAnyPinned) {
      // Pin the first 3 presets automatically so they show up on the Quick Bar
      return raw.map((t: CustomTemplate, idx: number) => ({
        ...t,
        is_pinned: idx < 3,
      }));
    }
    return raw.map((t: CustomTemplate) => ({
      ...t,
      is_pinned: Boolean(t.is_pinned),
    }));
  })();

  const [settings, setSettings] = useState<AppSettingsPayload>({
    ...initialSettings,
    payment_email: initialSettings.payment_email || 'payments@tiffin.ca',
    customer_message_templates: normalizedCustomerTemplates,
  });

  const [savedBaseline, setSavedBaseline] = useState<AppSettingsPayload>(settings);
  const [activeTab, setActiveTab] = useState<'driver' | 'admin'>('driver');
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedBaseline);

  // Navigation Guard States
  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);

  // 1. Intercept Browser Reload / Tab Close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // 2. Intercept Internal App Router Sidebar & Navigation Clicks
  useEffect(() => {
    if (!isDirty) return;

    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target || !target.href) return;

      const currentOrigin = window.location.origin;
      if (target.href.startsWith(currentOrigin) && target.href !== window.location.href) {
        e.preventDefault();
        e.stopPropagation();
        setPendingNavigationUrl(target.href);
        setShowExitModal(true);
      }
    };

    document.addEventListener('click', handleAnchorClick, true);
    return () => document.removeEventListener('click', handleAnchorClick, true);
  }, [isDirty]);

  const driverCustomTemplates: CustomTemplate[] = settings.custom_message_templates || [];
  const customerPresets: CustomTemplate[] = settings.customer_message_templates || [];

  const copyTag = (tag: string) => {
    navigator.clipboard?.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  // ── Handlers for Driver Tab ──
  const handleAddDriverTemplate = () => {
    const newTemplate: CustomTemplate = {
      id: `tpl_${Date.now()}`,
      title: 'New On-Demand Route Message',
      template: 'Hello, your tiffin has arrived! Enjoy your meal!',
    };
    setSettings(prev => ({
      ...prev,
      custom_message_templates: [...(prev.custom_message_templates || []), newTemplate],
    }));
  };

  const handleUpdateDriverTemplate = (id: string, updates: Partial<CustomTemplate>) => {
    setSettings(prev => ({
      ...prev,
      custom_message_templates: (prev.custom_message_templates || []).map(t =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  };

  const handleRemoveDriverTemplate = (id: string) => {
    setSettings(prev => ({
      ...prev,
      custom_message_templates: (prev.custom_message_templates || []).filter(t => t.id !== id),
    }));
  };

  // ── Handlers for Customer Presets Tab ──
  const handleAddCustomerPreset = () => {
    const newId = `cust_${Date.now()}`;
    const newPreset: CustomTemplate = {
      id: newId,
      title: 'New Customer Preset',
      tag: 'NEW',
      is_pinned: false,
      template: 'Hi {customer_name}, this is an update regarding your tiffin subscription.',
    };

    setSettings(prev => ({
      ...prev,
      customer_message_templates: [newPreset, ...(prev.customer_message_templates || [])],
    }));

    setNewlyCreatedId(newId);

    setTimeout(() => {
      setNewlyCreatedId(prev => (prev === newId ? null : prev));
    }, 4000);
  };

  const handleUpdateCustomerPreset = (id: string, updates: Partial<CustomTemplate>) => {
    setSettings(prev => ({
      ...prev,
      customer_message_templates: (prev.customer_message_templates || []).map(t =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  };

  const handleTogglePin = (preset: CustomTemplate) => {
    const currentPinned = (settings.customer_message_templates || []).filter(p => p.is_pinned).length;
    const isCurrentlyPinned = Boolean(preset.is_pinned);

    if (!isCurrentlyPinned && currentPinned >= 3) {
      showToast('Maximum 3 presets can be pinned to quick actions', 'error');
      return;
    }

    setSettings(prev => ({
      ...prev,
      customer_message_templates: (prev.customer_message_templates || []).map(p =>
        p.id === preset.id ? { ...p, is_pinned: !isCurrentlyPinned } : p
      ),
    }));
  };

  const handleRemoveCustomerPreset = (id: string) => {
    setSettings(prev => ({
      ...prev,
      customer_message_templates: (prev.customer_message_templates || []).filter(t => t.id !== id),
    }));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveAppSettings(settings);
      if (res.success) {
        setSavedBaseline(settings);
        showToast('Message presets & payment settings saved!');
      } else {
        showToast(res.message || 'Error saving settings', 'error');
      }
    });
  };

  const sampleVegPricing =
`🥗 *Vegetarian Plans:*
• *Regular (8oz):* $13 Daily | $60 Weekly (5) | $220 Monthly (20)
  _1 Dal + 1 Sabji + 6 Roti_
• *Large (12oz):* $15 Daily | $70 Weekly (5) | $250 Monthly (20)
  _1 Dal + 1 Sabji + Salad + 8 Roti + Weekly Dessert_`;

  const sampleNonVegPricing =
`🍗 *Non-Vegetarian Plans:*
_(Chicken Curry Mon/Wed/Fri • Veg Sabji Tue/Thu)_
• *Regular (8oz):* $15 Daily | $70 Weekly (5) | $250 Monthly (20)
  _Chicken/Sabji + 1 Dal + 6 Roti_
• *Large (12oz):* $17 Daily | $80 Weekly (5) | $280 Monthly (20)
  _Chicken/Sabji + 1 Dal + 8 Roti + Salad + Weekly Dessert_`;

  const samplePricingSheet =
`${sampleVegPricing}

${sampleNonVegPricing}

_• Deliveries Mon–Fri before 9:00 AM._
_• Fresh rotis daily (rice substitute optional)._`;

  const sampleCompile = (raw: string) => {
    return (raw || '')
      .replace(/{customer_name}/g, 'Vanshika')
      .replace(/{payment_method}/g, 'ETRANSFER')
      .replace(/{business_name}/g, 'TiffinBiz')
      .replace(/{amount}/g, '250.00')
      .replace(/{cycle_dates}/g, 'Sep 30 to Oct 28')
      .replace(/{total_credits}/g, '20')
      .replace(/{remaining_meals}/g, '6')
      .replace(/{cycle_end_date}/g, '2026-10-28')
      .replace(/{plan_tier}/g, 'Monthly')
      .replace(/{payment_email}/g, settings.payment_email || 'payments@tiffin.ca')
      .replace(/{veg_pricing}/g, sampleVegPricing)
      .replace(/{nonveg_pricing}/g, sampleNonVegPricing)
      .replace(/{pricing_sheet}/g, samplePricingSheet)
      .replace(/{address}/g, '1026 Roulston Cres');
  };

  return (
    <div className="space-y-4 font-sans pb-24">
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-6 shadow-2xs">

        {/* Header & Two-Tier Tab Bar */}
        <div className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                Communication Templates
              </h3>
              {isDirty && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">
                  ● Unsaved changes
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              Manage automated route drops and on-demand customer updates.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {isDirty && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleSave}
                className="px-3.5 py-1.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 duration-150 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 stroke-[3]" />}
                <span>Save</span>
              </button>
            )}

            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('driver')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${activeTab === 'driver'
                  ? 'bg-white text-[#5D5FEF] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                <Truck className="w-4 h-4" />
                <span>Driver Route Messages</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${activeTab === 'admin'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Customer Presets</span>
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Placeholder Tag Bar */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#5D5FEF]" />
            <span className="text-xs font-bold text-gray-700">Click a tag to copy to clipboard:</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(activeTab === 'driver'
              ? ['{customer_name}', '{address}', '{remaining_meals}', '{cycle_end_date}']
              : [
                  '{customer_name}',
                  '{amount}',
                  '{payment_method}',
                  '{cycle_dates}',
                  '{total_credits}',
                  '{remaining_meals}',
                  '{cycle_end_date}',
                  '{plan_tier}',
                  '{business_name}',
                  '{payment_email}',
                  '{veg_pricing}',
                  '{nonveg_pricing}',
                  '{pricing_sheet}',
                ]
            ).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => copyTag(tag)}
                className="px-2.5 py-1 bg-white border border-gray-300 hover:border-[#5D5FEF] hover:bg-[#5D5FEF] hover:text-white rounded-xl text-xs font-mono font-bold text-gray-800 cursor-pointer transition-all shadow-2xs flex items-center gap-1 duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              >
                <span>{tag}</span>
                {copiedTag === tag && <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB 1: DRIVER ON-ROUTE MESSAGES ── */}
        {activeTab === 'driver' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Routine Mon-Thu */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-gray-900 tracking-tight">Standard Delivery Message</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Routine (Mon–Thu)
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.delivery_message_template}
                  onChange={e => setSettings(prev => ({ ...prev, delivery_message_template: e.target.value }))}
                  className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80">
                  <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block mb-0.5">WhatsApp Preview</span>
                  <p className="text-xs italic text-emerald-950">&quot;{sampleCompile(settings.delivery_message_template)}&quot;</p>
                </div>
              </div>

              {/* Friday Greeting */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-gray-900 tracking-tight">Friday Weekend Greeting</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                    Friday Stop
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.friday_message_template || ''}
                  onChange={e => setSettings(prev => ({ ...prev, friday_message_template: e.target.value }))}
                  className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80">
                  <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider block mb-0.5">Friday Preview</span>
                  <p className="text-xs italic text-blue-950">&quot;{sampleCompile(settings.friday_message_template || '')}&quot;</p>
                </div>
              </div>

              {/* Final Day of Cycle */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-gray-900 tracking-tight">Final Day of Cycle Message</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                    Cycle Renewal
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.last_day_message_template}
                  onChange={e => setSettings(prev => ({ ...prev, last_day_message_template: e.target.value }))}
                  className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-rose-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200/80">
                  <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider block mb-0.5">Renewal Preview</span>
                  <p className="text-xs italic text-rose-950">&quot;{sampleCompile(settings.last_day_message_template)}&quot;</p>
                </div>
              </div>
            </div>

            {/* Custom On-Demand Route Presets */}
            <div className="pt-6 border-t border-gray-200/80 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                    Custom On-Demand Route Presets
                  </h4>
                  <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                    Optional messages drivers can pick directly from the route stop menu (weather delays, double packs).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddDriverTemplate}
                  className="px-3.5 py-1.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Preset</span>
                </button>
              </div>

              {driverCustomTemplates.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                  <p className="text-xs font-semibold text-gray-500">No custom templates configured yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {driverCustomTemplates.map(item => (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={item.title}
                          onChange={e => handleUpdateDriverTemplate(item.id, { title: e.target.value })}
                          className="font-bold text-xs text-gray-900 border-b border-gray-200 focus:border-[#5D5FEF] outline-none pb-0.5 w-3/4 bg-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveDriverTemplate(item.id)}
                          className="w-7 h-7 rounded-xl bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 flex items-center justify-center transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={item.template}
                        onChange={e => handleUpdateDriverTemplate(item.id, { template: e.target.value })}
                        className="w-full p-2.5 text-xs text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none resize-none leading-relaxed"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 2: 100% DYNAMIC CUSTOMER PRESETS ── */}
        {activeTab === 'admin' && (
          <div className="space-y-6">

            {/* Interac e-Transfer Payment Email Setting */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div>
                <label className="text-xs font-black uppercase text-emerald-950 tracking-wide block">
                  Interac e-Transfer Payment Email
                </label>
                <p className="text-[11.5px] text-emerald-700 font-medium mt-0.5">
                  Dynamically populates the <code className="px-1.5 py-0.5 bg-white/80 rounded font-mono font-bold text-emerald-900 border border-emerald-200">&#123;payment_email&#125;</code> tag across balance summaries &amp; customer updates.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={settings.payment_email || ''}
                  onChange={e => setSettings(prev => ({ ...prev, payment_email: e.target.value }))}
                  placeholder="payments@tiffin.ca"
                  className="w-full sm:w-64 px-3.5 py-2 text-xs font-bold text-gray-900 bg-white border border-emerald-300 rounded-xl focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none shadow-2xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                    Active Customer Presets ({customerPresets.length})
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200">
                    ⭐ {customerPresets.filter(p => p.is_pinned).length}/3 Pinned to Quick Bar
                  </span>
                </div>
                <p className="text-[11.5px] text-gray-500 font-medium mt-0.5">
                  Pin up to 3 presets to show as primary pills in the send modal. All others appear in the &quot;More Templates&quot; dropdown.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddCustomerPreset}
                className="px-3.5 py-2 bg-[#00D1B2] hover:bg-[#00c4a7] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Add Customer Preset</span>
              </button>
            </div>

            {customerPresets.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50 space-y-2">
                <p className="text-xs font-bold text-gray-600">No customer presets configured.</p>
                <p className="text-[11px] text-gray-400">Click &quot;Add Customer Preset&quot; above to create one.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {customerPresets.map((preset, index) => {
                  const isNew = preset.id === newlyCreatedId;

                  return (
                    <div
                      key={preset.id}
                      className={`bg-white rounded-2xl p-4.5 space-y-3 relative transition-all duration-500 ${isNew
                          ? 'border-2 border-[#00D1B2] shadow-lg shadow-[#00D1B2]/10 ring-4 ring-[#00D1B2]/15 scale-[1.01]'
                          : 'border border-gray-200/90 shadow-2xs'
                        }`}
                    >
                      {/* Header Row: Title & Pin & Badge & Delete */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {isNew ? (
                            <span className="text-[10px] font-black text-white bg-[#00D1B2] px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse shrink-0">
                              NEW
                            </span>
                          ) : (
                            <span className="text-[10px] font-black text-gray-400 font-mono shrink-0">
                              #{index + 1}
                            </span>
                          )}
                          <input
                            type="text"
                            autoFocus={isNew}
                            onFocus={e => isNew && e.target.select()}
                            value={preset.title}
                            onChange={e => handleUpdateCustomerPreset(preset.id, { title: e.target.value })}
                            placeholder="Preset Title"
                            className="font-black text-xs text-gray-900 border-b border-gray-200 focus:border-[#5D5FEF] outline-none pb-0.5 flex-1 bg-transparent"
                          />
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Pin Toggle Button */}
                          <button
                            type="button"
                            onClick={() => handleTogglePin(preset)}
                            title={preset.is_pinned ? 'Pinned to Top 3 Quick Bar (Click to unpin)' : 'Pin to Top 3 Quick Bar'}
                            className={`px-2 py-0.5 rounded-xl text-xs font-bold border flex items-center gap-1 transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${preset.is_pinned
                                ? 'bg-amber-50 text-amber-900 border-amber-300'
                                : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-600'
                              }`}
                          >
                            <Star className={`w-3 h-3 ${preset.is_pinned ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
                            <span>{preset.is_pinned ? 'Top 3' : 'Pin'}</span>
                          </button>

                          <input
                            type="text"
                            value={preset.tag || ''}
                            onChange={e => handleUpdateCustomerPreset(preset.id, { tag: e.target.value.toUpperCase() })}
                            placeholder="TAG"
                            className="w-16 px-1.5 py-0.5 text-[9.5px] font-black uppercase text-center bg-slate-100 text-slate-700 border border-slate-200 rounded outline-none focus:border-[#5D5FEF]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomerPreset(preset.id)}
                            title="Delete Preset"
                            className="w-7 h-7 rounded-xl bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 flex items-center justify-center transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Template Text Area */}
                      <textarea
                        rows={3}
                        value={preset.template}
                        onChange={e => handleUpdateCustomerPreset(preset.id, { template: e.target.value })}
                        placeholder="Write message template with {placeholders}..."
                        className="w-full p-3 text-xs font-medium text-gray-900 bg-slate-50/70 border border-gray-200 rounded-xl focus:border-[#5D5FEF] focus:bg-white outline-none leading-relaxed resize-none shadow-2xs"
                      />

                      {/* Live Preview */}
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/90 space-y-0.5">
                        <span className="text-[9.5px] font-black uppercase text-slate-500 tracking-wider block">
                          Live Preview (Vanshika)
                        </span>
                        <p className="text-xs italic text-slate-800 leading-snug whitespace-pre-line font-medium">
                          &quot;{sampleCompile(preset.template)}&quot;
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        </div>

      {/* ── FIXED SAVE BAR STUCK DIRECTLY TO THE BOTTOM OF THE PAGE ── */}
      {isMounted && createPortal(
        <>
          <div className="fixed bottom-0 left-0 md:left-64 right-0 z-[999] bg-white/95 backdrop-blur-md border-t border-gray-200/90 px-6 sm:px-8 py-3.5 shadow-[0_-4px_25px_rgba(0,0,0,0.08)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Unsaved changes pending
                </span>
              ) : (
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-500 stroke-[2.5]" />
                  All settings up to date
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {isDirty && (
                <button
                  type="button"
                  onClick={() => setSettings(savedBaseline)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  Discard
                </button>
              )}

              <button
                type="button"
                disabled={isPending || !isDirty}
                onClick={handleSave}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  isDirty
                    ? 'bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white cursor-pointer ring-2 ring-[#5D5FEF]/20'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200/70'
                }`}
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>{isPending ? 'Saving…' : 'Save Changes'}</span>
              </button>
            </div>
          </div>

          {/* ── UNSAVED CHANGES WARNING MODAL ── */}
          {showExitModal && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
              <div
                className="fixed inset-0 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
                onClick={() => setShowExitModal(false)}
              />
              <div
                className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md p-6 space-y-4 font-sans animate-in zoom-in-95 duration-150"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                    <span className="text-lg">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight">
                      Unsaved Changes Warning
                    </h3>
                    <p className="text-xs text-gray-500 font-medium mt-1 leading-relaxed">
                      You have modified message templates or settings that have not been saved to the database. Leaving now will discard these changes.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowExitModal(false);
                      setPendingNavigationUrl(null);
                    }}
                    className="px-4 py-2 border border-gray-200 text-gray-700 font-bold rounded-xl text-xs hover:bg-gray-50 transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    Stay &amp; Keep Editing
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowExitModal(false);
                      if (pendingNavigationUrl) {
                        window.location.href = pendingNavigationUrl;
                      }
                    }}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs shadow-2xs transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    Discard &amp; Leave
                  </button>
                </div>
              </div>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  );
}