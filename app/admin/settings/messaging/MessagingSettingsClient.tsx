'use client';

import { useState, useTransition } from 'react';
import { Check, AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { saveAppSettings, type AppSettingsPayload, type CustomTemplate } from '../actions';
import { formatDeliveryMessage } from '@/app/utils/messageTemplate';

export default function MessagingSettingsClient({
  initialSettings,
}: {
  initialSettings: AppSettingsPayload;
}) {
  const [settings, setSettings] = useState<AppSettingsPayload>(initialSettings);
  const [savedBaseline, setSavedBaseline] = useState<AppSettingsPayload>(initialSettings);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedBaseline);

  const customTemplates: CustomTemplate[] = settings.custom_message_templates || [];

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
    setStatus('idle');
    setErrorMsg('');

    startTransition(async () => {
      const res = await saveAppSettings(settings);
      if (res.success) {
        setSavedBaseline(settings);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('error');
        setErrorMsg(res.message || 'Error saving settings');
      }
    });
  };

  const sampleStandard = formatDeliveryMessage(settings.delivery_message_template, {
    customer_name: 'Eshank',
    address: '1026 Roulston Cres',
    remaining_meals: 4,
  });

  const sampleFriday = formatDeliveryMessage(
    settings.friday_message_template || 'Hello, your tiffin has been delivered! Have a wonderful weekend!',
    { customer_name: 'Eshank', address: '1026 Roulston Cres', remaining_meals: 3 }
  );

  const sampleLastDay = formatDeliveryMessage(settings.last_day_message_template, {
    customer_name: 'Eshank',
    address: '1026 Roulston Cres',
    remaining_meals: 0,
  });

  return (
    <div className="space-y-4">
      {/* Toast Feedback */}
      {status === 'saved' && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Message templates saved and active across all dispatch routes!</span>
        </div>
      )}

      {status === 'error' && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-6 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
            Notification Templates
          </h3>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Pre-filled message text when drivers send WhatsApp or SMS updates on route.
          </p>
        </div>

        {/* Placeholders Tag Bar */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#5D5FEF]" />
            <span className="text-xs font-bold text-gray-700">Click a tag to copy to clipboard:</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { tag: '{address}', label: 'Address' },
              { tag: '{remaining_meals}', label: 'Remaining Balance' },
            ].map(item => (
              <button
                key={item.tag}
                type="button"
                onClick={() => navigator.clipboard.writeText(item.tag)}
                title={`Copy ${item.label}`}
                className="px-2.5 py-1 bg-white border border-gray-300 hover:border-[#5D5FEF] hover:bg-[#5D5FEF] hover:text-white rounded-lg text-xs font-mono font-bold text-gray-800 cursor-pointer transition-all shadow-2xs group flex items-center gap-1"
              >
                <span>{item.tag}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 1. Core Presets Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Standard Mon-Thu */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-gray-900 tracking-tight">Standard Delivery Message</label>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                Routine Stop (Mon–Thu)
              </span>
            </div>
            <textarea
              rows={4}
              value={settings.delivery_message_template}
              onChange={e => setSettings(prev => ({ ...prev, delivery_message_template: e.target.value }))}
              className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed shadow-2xs"
            />
            <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80 space-y-0.5">
              <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block">WhatsApp Preview</span>
              <p className="text-xs italic text-emerald-950">&quot;{sampleStandard}&quot;</p>
            </div>
          </div>

          {/* Friday Stop */}
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
            <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80 space-y-0.5">
              <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider block">Friday Preview</span>
              <p className="text-xs italic text-blue-950">&quot;{sampleFriday}&quot;</p>
            </div>
          </div>

          {/* Final Day */}
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
            <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200/80 space-y-0.5">
              <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider block">Renewal Preview</span>
              <p className="text-xs italic text-rose-950">&quot;{sampleLastDay}&quot;</p>
            </div>
          </div>
        </div>

        {/* 2. Custom On-Demand Templates Section */}
        <div className="pt-6 border-t border-gray-200/80 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                Custom On-Demand Templates
              </h4>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                Special occasion messages (holidays, delays, promotions) drivers can pick directly from the route stop menu.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddCustomTemplate}
              className="px-3.5 py-2 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Template</span>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {customTemplates.map(item => {
                const previewText = formatDeliveryMessage(item.template, {
                  customer_name: '',
                  address: '1026 Roulston Cres',
                  remaining_meals: 3,
                });

                return (
                  <div
                    key={item.id}
                    className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2.5 shadow-2xs relative"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={item.title}
                        onChange={e => handleUpdateCustomTemplate(item.id, { title: e.target.value })}
                        placeholder="Template Title (e.g. Long Weekend)"
                        className="font-bold text-xs text-gray-900 border-b border-gray-200 focus:border-[#5D5FEF] outline-none pb-0.5 w-3/4 bg-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomTemplate(item.id)}
                        title="Delete template"
                        className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <textarea
                      rows={3}
                      value={item.template}
                      onChange={e => handleUpdateCustomTemplate(item.id, { template: e.target.value })}
                      placeholder="Write message template..."
                      className="w-full p-2.5 text-xs text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none resize-none leading-relaxed"
                    />

                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-200/70 space-y-0.5">
                      <span className="text-[9.5px] font-black uppercase text-gray-400 tracking-wider block">
                        WhatsApp Preview
                      </span>
                      <p className="text-[11.5px] italic text-gray-700 leading-snug">
                        &quot;{previewText}&quot;
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card Footer */}
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