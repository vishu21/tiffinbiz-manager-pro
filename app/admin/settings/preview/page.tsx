'use client';

import React, { useState } from 'react';
import { 
  MessageSquare, 
  Truck, 
  CreditCard, 
  Send, 
  Copy, 
  Check, 
  X, 
  Plus, 
  Trash2,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';

export default function UnifiedMessagingPreview() {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'driver' | 'admin'>('driver');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  // 1. Driver Route Templates (app_settings)
  const [driverSettings, setDriverSettings] = useState({
    delivery_message_template: 'Hello {customer_name}, your tiffin has been delivered! Thank you!',
    friday_message_template: 'Hello {customer_name}, your tiffin has been delivered! Have a wonderful weekend!',
    last_day_message_template: 'Hello {customer_name}, your tiffin has been delivered! Today is your final delivery for this cycle. Please leave your empty tiffin bag out for collection. Thank you!',
  });

  // 2. Admin & Customer Communication Templates (app_settings)
  const [adminSettings, setAdminSettings] = useState({
    msg_meals_remaining: 'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your cycle.',
    msg_cycle_end: 'Hi {customer_name}, your current delivery cycle runs until {cycle_end_date}.',
    msg_balance_summary: 'Hi {customer_name}, this is your balance summary: ${amount} CAD is due for {cycle_dates} ({remaining_meals} meals left). Please send Interac e-Transfer to {payment_email}. Thank you!',
    msg_renewal: 'Hi {customer_name}, your {plan_tier} plan ends on {cycle_end_date}. Please let us know if you would like to renew or make adjustments for next cycle. Thank you!',
  });

  // Custom on-demand templates (holidays, delays, etc.)
  const [customTemplates, setCustomTemplates] = useState([
    { id: '1', title: 'Friday Double-Pack', template: 'Hello, your tiffins have been delivered! Today includes 2 tiffins for Friday and Saturday. Please refrigerate the Saturday meal.' },
  ]);

  // Modal State for testing Quick Message
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeModalPreset, setActiveModalPreset] = useState<'meals' | 'cycleEnd' | 'balance' | 'renewal' | string>('balance');
  const [modalEditableText, setModalEditableText] = useState('');
  const [modalSentSuccess, setModalSentSuccess] = useState(false);

  // Sample Customer Data (matches Vanshika in your screenshot)
  const sampleCustomer = {
    name: 'Vanshika',
    phone: '+1 (548) 388-4745',
    plan_tier: 'Monthly',
    remaining_meals: 6,
    total_meals: 20,
    cycle_end_date: '2026-10-28',
    cycle_dates: 'Sep 30 → Oct 28',
    amount: '250.00',
    payment_email: 'payments@tiffin.ca',
  };

  const copyTag = (tag: string) => {
    navigator.clipboard?.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  // Compile template tags with real customer data
  const compileTemplate = (rawTemplate: string) => {
    return rawTemplate
      .replace(/{customer_name}/g, sampleCustomer.name)
      .replace(/{remaining_meals}/g, String(sampleCustomer.remaining_meals))
      .replace(/{total_credits}/g, String(sampleCustomer.total_meals))
      .replace(/{cycle_end_date}/g, sampleCustomer.cycle_end_date)
      .replace(/{cycle_dates}/g, sampleCustomer.cycle_dates)
      .replace(/{amount}/g, sampleCustomer.amount)
      .replace(/{plan_tier}/g, sampleCustomer.plan_tier)
      .replace(/{payment_email}/g, sampleCustomer.payment_email);
  };

  // Open modal pre-populated with a specific preset
  const openModalWithPreset = (presetKey: 'meals' | 'cycleEnd' | 'balance' | 'renewal') => {
    setActiveModalPreset(presetKey);
    let raw = '';
    if (presetKey === 'meals') raw = adminSettings.msg_meals_remaining;
    else if (presetKey === 'cycleEnd') raw = adminSettings.msg_cycle_end;
    else if (presetKey === 'balance') raw = adminSettings.msg_balance_summary;
    else if (presetKey === 'renewal') raw = adminSettings.msg_renewal;

    setModalEditableText(compileTemplate(raw));
    setModalSentSuccess(false);
    setIsModalOpen(true);
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-7 font-sans bg-[#F8FAFC] text-slate-800 space-y-6">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">System Settings</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Interactive Preview
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Configure automated driver messages, administrative customer communication presets, and review modal behavior[cite: 20].
          </p>
        </div>

        <button
          type="button"
          onClick={() => openModalWithPreset('balance')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Test "Quick Message" Modal for Vanshika</span>
        </button>
      </div>

      {/* ── SETTINGS CONTAINER CARD ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-xs space-y-6">
        
        {/* TAB TOGGLE: Driver vs Customer Admin */}
        <div className="flex border-b border-slate-200 pb-3 justify-between items-center flex-wrap gap-3">
          <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveSettingsTab('driver')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSettingsTab === 'driver'
                  ? 'bg-white text-[#5D5FEF] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>Driver On-Route Messages</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSettingsTab('admin')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSettingsTab === 'admin'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Customer &amp; Admin Presets</span>
            </button>
          </div>

          <span className="text-xs text-slate-400 font-semibold">
            {activeSettingsTab === 'driver' ? 'Automated Dispatch Handlers' : 'Powers the Quick Message Modal'}
          </span>
        </div>

        {/* DYNAMIC PLACEHOLDER TAG BAR */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#5D5FEF]" />
            <span className="text-xs font-bold text-slate-700">Click a tag to copy to clipboard:</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(activeSettingsTab === 'driver'
              ? ['{customer_name}', '{address}', '{remaining_meals}', '{cycle_end_date}']
              : ['{customer_name}', '{remaining_meals}', '{cycle_end_date}', '{cycle_dates}', '{amount}', '{plan_tier}', '{payment_email}']
            ).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => copyTag(tag)}
                className="px-2.5 py-1 bg-white border border-slate-300 hover:border-[#5D5FEF] hover:bg-[#5D5FEF] hover:text-white rounded-lg text-xs font-mono font-bold text-slate-700 cursor-pointer transition-all shadow-2xs flex items-center gap-1"
              >
                <span>{tag}</span>
                {copiedTag === tag && <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB 1: DRIVER ON-ROUTE MESSAGES ── */}
        {activeSettingsTab === 'driver' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Routine Mon-Thu */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Standard Delivery (Mon–Thu)</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                    Routine
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={driverSettings.delivery_message_template}
                  onChange={e => setDriverSettings({ ...driverSettings, delivery_message_template: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80">
                  <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block mb-0.5">WhatsApp Preview</span>
                  <p className="text-xs italic text-emerald-950">"{compileTemplate(driverSettings.delivery_message_template)}"</p>
                </div>
              </div>

              {/* Friday Greeting */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Friday Weekend Stop</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                    Friday
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={driverSettings.friday_message_template}
                  onChange={e => setDriverSettings({ ...driverSettings, friday_message_template: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80">
                  <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider block mb-0.5">WhatsApp Preview</span>
                  <p className="text-xs italic text-blue-950">"{compileTemplate(driverSettings.friday_message_template)}"</p>
                </div>
              </div>

              {/* Cycle Renewal / Last Day */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Final Day of Cycle Message</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300 uppercase">
                    Renewal
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={driverSettings.last_day_message_template}
                  onChange={e => setDriverSettings({ ...driverSettings, last_day_message_template: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-rose-400 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200/80">
                  <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider block mb-0.5">WhatsApp Preview</span>
                  <p className="text-xs italic text-rose-950">"{compileTemplate(driverSettings.last_day_message_template)}"</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: CUSTOMER & ADMINISTRATIVE MESSAGE PRESETS ── */}
        {activeSettingsTab === 'admin' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              
              {/* 1. Meals Remaining Preset */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 1: Meals Remaining</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                    Inquiry
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={adminSettings.msg_meals_remaining}
                  onChange={e => setAdminSettings({ ...adminSettings, msg_meals_remaining: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-slate-800">"{compileTemplate(adminSettings.msg_meals_remaining)}"</p>
                </div>
              </div>

              {/* 2. Cycle End Date Preset */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 2: Cycle End Date</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                    Schedule
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={adminSettings.msg_cycle_end}
                  onChange={e => setAdminSettings({ ...adminSettings, msg_cycle_end: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-slate-800">"{compileTemplate(adminSettings.msg_cycle_end)}"</p>
                </div>
              </div>

              {/* 3. Full Balance / Billing Due Preset */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 3: Full Balance Summary (Billing Due)</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 uppercase">
                    Billing Due
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={adminSettings.msg_balance_summary}
                  onChange={e => setAdminSettings({ ...adminSettings, msg_balance_summary: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80">
                  <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-emerald-950">"{compileTemplate(adminSettings.msg_balance_summary)}"</p>
                </div>
              </div>

              {/* 4. Renewal Notice Preset */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 4: Cycle Renewal Notice</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 uppercase">
                    Renewal
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={adminSettings.msg_renewal}
                  onChange={e => setAdminSettings({ ...adminSettings, msg_renewal: e.target.value })}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-amber-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/80">
                  <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-amber-950">"{compileTemplate(adminSettings.msg_renewal)}"</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FOOTER */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">Settings are saved globally in Supabase and shared across customers, billing, and deliveries.</span>
          <button
            type="button"
            onClick={() => alert('Saved Settings Successfully!')}
            className="px-5 py-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      {/* ── UPGRADED QUICK MESSAGE MODAL (Exact match for your screenshot) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#5D5FEF]/10 text-[#5D5FEF] flex items-center justify-center font-bold">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 tracking-tight">Send Customer Update</h3>
                  <p className="text-[11.5px] text-slate-500 font-semibold">
                    To <strong className="text-slate-800 capitalize">{sampleCustomer.name}</strong> ({sampleCustomer.phone})
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* Select Inquiry / Message Template Pills */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                  Select Inquiry / Message Template
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: 'meals', label: '🍱 Meals Remaining' },
                    { key: 'cycleEnd', label: '📅 Cycle End Date' },
                    { key: 'balance', label: '💳 Full Balance Summary' },
                    { key: 'renewal', label: '⏳ Renewal Notice' },
                  ].map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setActiveModalPreset(preset.key);
                        let raw = '';
                        if (preset.key === 'meals') raw = adminSettings.msg_meals_remaining;
                        else if (preset.key === 'cycleEnd') raw = adminSettings.msg_cycle_end;
                        else if (preset.key === 'balance') raw = adminSettings.msg_balance_summary;
                        else if (preset.key === 'renewal') raw = adminSettings.msg_renewal;
                        setModalEditableText(compileTemplate(raw));
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        activeModalPreset === preset.key
                          ? 'bg-[#00D1B2] text-white border-[#00D1B2] shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable Outgoing Textarea */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Message Text (Editable)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(modalEditableText);
                      alert('Copied message text to clipboard!');
                    }}
                    className="text-xs font-bold text-[#5D5FEF] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={modalEditableText}
                  onChange={e => setModalEditableText(e.target.value)}
                  className="w-full p-3 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#5D5FEF] outline-none leading-relaxed text-slate-800"
                />
              </div>

              {modalSentSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs font-bold text-emerald-800">
                  <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                  <span>WhatsApp Web launched &amp; message pre-filled!</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  const clean = sampleCustomer.phone.replace(/[^0-9]/g, '');
                  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(modalEditableText)}`, '_blank');
                  setModalSentSuccess(true);
                }}
                className="px-5 py-2.5 bg-[#25D366] hover:bg-[#20bd5a] text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send via WhatsApp</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}