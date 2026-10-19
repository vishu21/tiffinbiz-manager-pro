'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, Plus, Trash2, Truck, MessageSquare } from 'lucide-react';
import { saveAppSettings, type AppSettingsPayload, type CustomTemplate } from '../actions';
import { useToast } from '@/app/components/ToastProvider';

export default function MessagingSettingsClient({
  initialSettings,
}: {
  initialSettings: AppSettingsPayload;
}) {
  const [settings, setSettings] = useState<AppSettingsPayload>({
    ...initialSettings,
    msg_meals_remaining:
      initialSettings.msg_meals_remaining ||
      'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your cycle.',
    msg_cycle_end:
      initialSettings.msg_cycle_end ||
      'Hi {customer_name}, your current delivery cycle runs until {cycle_end_date}.',
    msg_balance_summary:
      initialSettings.msg_balance_summary ||
      'Hi {customer_name}, this is your balance summary: ${amount} CAD is due for {cycle_dates} ({remaining_meals} meals left). Please send Interac e-Transfer to {payment_email}. Thank you!',
    msg_renewal:
      initialSettings.msg_renewal ||
      'Hi {customer_name}, your {plan_tier} plan ends on {cycle_end_date}. Please let us know if you would like to renew or make adjustments for next cycle. Thank you!',
    msg_term_progress:
      initialSettings.msg_term_progress ||
      'Hi {customer_name}, you have {remaining_meals} out of {total_credits} tiffins remaining in your current {plan_tier} term ending on {cycle_end_date}.',
  });
  const [savedBaseline, setSavedBaseline] = useState<AppSettingsPayload>(settings);
  const [activeTab, setActiveTab] = useState<'driver' | 'admin'>('driver');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedBaseline);
  const customTemplates: CustomTemplate[] = settings.custom_message_templates || [];

  const copyTag = (tag: string) => {
    navigator.clipboard?.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  const handleAddCustomTemplate = () => {
    const newTemplate: CustomTemplate = {
      id: `tpl_${Date.now()}`,
      title: 'New Custom Template',
      template: 'Hello, your tiffin has arrived! Enjoy your meal!',
    };
    setSettings(prev => ({
      ...prev,
      custom_message_templates: [...(prev.custom_message_templates || []), newTemplate],
    }));
  };

  const handleUpdateCustomTemplate = (id: string, updates: Partial<CustomTemplate>) => {
    setSettings(prev => ({
      ...prev,
      custom_message_templates: (prev.custom_message_templates || []).map(t =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  };

  const handleRemoveCustomTemplate = (id: string) => {
    setSettings(prev => ({
      ...prev,
      custom_message_templates: (prev.custom_message_templates || []).filter(t => t.id !== id),
    }));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveAppSettings(settings);
      if (res.success) {
        setSavedBaseline(settings);
        showToast('Message templates saved and active across all dispatch & messaging routes!');
      } else {
        showToast(res.message || 'Error saving settings', 'error');
      }
    });
  };

  const sampleCompile = (raw: string) => {
    return (raw || '')
      .replace(/{customer_name}/g, 'Vanshika')
      .replace(/{remaining_meals}/g, '6')
      .replace(/{total_credits}/g, '20')
      .replace(/{cycle_end_date}/g, '2026-10-28')
      .replace(/{cycle_dates}/g, 'Sep 30 → Oct 28')
      .replace(/{amount}/g, '250.00')
      .replace(/{plan_tier}/g, 'Monthly')
      .replace(/{payment_email}/g, 'payments@tiffin.ca')
      .replace(/{address}/g, '1026 Roulston Cres');
  };

  return (
    <div className="space-y-4 font-sans">
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-6 shadow-2xs">

        {/* Header & Two-Tier Tab Bar */}
        <div className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
              Communication Templates
            </h3>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              Manage automated route drops and on-demand customer updates.
            </p>
          </div>

          <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('driver')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'driver'
                  ? 'bg-white text-[#5D5FEF] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              <Truck className="w-4 h-4" />
              <span>Driver Route Messages</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'admin'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Customer Presets</span>
            </button>
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
              : ['{customer_name}', '{remaining_meals}', '{total_credits}', '{cycle_end_date}', '{cycle_dates}', '{amount}', '{plan_tier}', '{payment_email}']
            ).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => copyTag(tag)}
                className="px-2.5 py-1 bg-white border border-gray-300 hover:border-[#5D5FEF] hover:bg-[#5D5FEF] hover:text-white rounded-lg text-xs font-mono font-bold text-gray-800 cursor-pointer transition-all shadow-2xs flex items-center gap-1"
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
                  className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-rose-500 outline-none leading-relaxed shadow-2xs"
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
                  onClick={handleAddCustomTemplate}
                  className="px-3.5 py-1.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Preset</span>
                </button>
              </div>

              {customTemplates.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                  <p className="text-xs font-semibold text-gray-500">No custom templates configured yet.</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Create templates for weather delays, long weekend notices, festival sweets, or vacation notes.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {customTemplates.map(item => (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={item.title}
                          onChange={e => handleUpdateCustomTemplate(item.id, { title: e.target.value })}
                          className="font-bold text-xs text-gray-900 border-b border-gray-200 focus:border-[#5D5FEF] outline-none pb-0.5 w-3/4 bg-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomTemplate(item.id)}
                          className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={item.template}
                        onChange={e => handleUpdateCustomTemplate(item.id, { template: e.target.value })}
                        className="w-full p-2.5 text-xs text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none resize-none leading-relaxed"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 2: CUSTOMER & ADMINISTRATIVE MESSAGE PRESETS ── */}
        {activeTab === 'admin' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Preset 1: Meals Remaining */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 1: Meals Remaining</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                    Inquiry
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={settings.msg_meals_remaining}
                  onChange={e => setSettings(prev => ({ ...prev, msg_meals_remaining: e.target.value }))}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-slate-800">&quot;{sampleCompile(settings.msg_meals_remaining || '')}&quot;</p>
                </div>
              </div>

              {/* Preset 2: Cycle End Date */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 2: Cycle End Date</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                    Schedule
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={settings.msg_cycle_end}
                  onChange={e => setSettings(prev => ({ ...prev, msg_cycle_end: e.target.value }))}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-slate-800">&quot;{sampleCompile(settings.msg_cycle_end || '')}&quot;</p>
                </div>
              </div>

              {/* Preset 3: Full Balance Summary */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 3: Full Balance Summary (Billing Due)</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 uppercase">
                    Billing Due
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.msg_balance_summary}
                  onChange={e => setSettings(prev => ({ ...prev, msg_balance_summary: e.target.value }))}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80">
                  <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-emerald-950">&quot;{sampleCompile(settings.msg_balance_summary || '')}&quot;</p>
                </div>
              </div>

              {/* Preset 4: Renewal Notice */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 4: Cycle Renewal Notice</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 uppercase">
                    Renewal
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.msg_renewal}
                  onChange={e => setSettings(prev => ({ ...prev, msg_renewal: e.target.value }))}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-amber-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/80">
                  <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider block mb-0.5">Live Preview (Vanshika)</span>
                  <p className="text-xs italic text-amber-950">&quot;{sampleCompile(settings.msg_renewal || '')}&quot;</p>
                </div>
              </div>
              {/* Preset 5: Term & Tiffins Remaining Progress */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-900">Preset 5: Term Tiffins Remaining</label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 uppercase">
                    Term Progress
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={settings.msg_term_progress}
                  onChange={e => setSettings(prev => ({ ...prev, msg_term_progress: e.target.value }))}
                  className="w-full p-3 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:border-purple-500 outline-none leading-relaxed shadow-2xs"
                />
                <div className="p-3 bg-purple-50/70 rounded-xl border border-purple-200/80">
                  <span className="text-[10px] font-black uppercase text-purple-800 tracking-wider block mb-0.5">
                    Live Preview (Vanshika)
                  </span>
                  <p className="text-xs italic text-purple-950">
                    &quot;{sampleCompile(settings.msg_term_progress || '')}&quot;
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {isDirty ? <span className="text-amber-600 font-bold">● Unsaved changes pending</span> : 'All settings up to date'}
          </span>

          <div className="flex items-center gap-2.5">
            {isDirty && (
              <button
                type="button"
                onClick={() => setSettings(savedBaseline)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Discard
              </button>
            )}

            <button
              type="button"
              disabled={isPending || !isDirty}
              onClick={handleSave}
              className="px-5 py-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[3]" />}
              <span>{isPending ? 'Saving…' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}