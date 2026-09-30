'use client';

import { useState, useTransition } from 'react';
import { MessageSquare, Check, AlertCircle, Loader2 } from 'lucide-react';
import { saveDriverMessageSettings, type DriverMessageSettings } from './actions';
import { formatDeliveryMessage } from '@/app/utils/messageTemplate';

export default function SettingsClient({
  initialSettings,
}: {
  initialSettings: DriverMessageSettings;
}) {
  const [settings, setSettings] = useState<DriverMessageSettings>(initialSettings);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    setStatus('idle');
    setErrorMsg('');

    startTransition(async () => {
      const res = await saveDriverMessageSettings(settings);
      if (res.success) {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('error');
        setErrorMsg(res.message || 'Error saving template settings');
      }
    });
  };

  const samplePreviewStandard = formatDeliveryMessage(settings.delivery_message_template, {
    customer_name: 'Eshank',
    address: '1026 Roulston Cres',
    remaining_meals: 4,
  });

  const samplePreviewLastDay = formatDeliveryMessage(settings.last_day_message_template, {
    customer_name: 'Eshank',
    address: '1026 Roulston Cres',
    remaining_meals: 0,
  });

  return (
    <div className="space-y-6">
      {status === 'saved' && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Templates saved successfully and active for dispatch!</span>
        </div>
      )}

      {status === 'error' && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-2xs space-y-6">
        <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg bg-[#5D5FEF]/10 text-[#5D5FEF] flex items-center justify-center font-bold">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-gray-900 uppercase tracking-wide">
              Driver Dispatch Notification Templates
            </h2>
            <p className="text-[11px] text-gray-400 font-semibold">
              These messages pre-fill when the driver taps WhatsApp or SMS on the delivery route.
            </p>
          </div>
        </div>

        {/* Dynamic Placeholders Tag Cloud */}
        <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-1.5">
          <span className="text-[10.5px] font-black uppercase tracking-wider text-indigo-700 block">
            Available Dynamic Tags (Click to copy)
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {['{customer_name}', '{address}', '{remaining_meals}'].map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => navigator.clipboard.writeText(tag)}
                title="Click to copy tag"
                className="px-2 py-0.5 bg-white border border-indigo-200 rounded text-xs font-mono font-bold text-indigo-800 hover:bg-indigo-100 cursor-pointer transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Template 1: Standard Delivery */}
        <div className="space-y-2">
          <label className="block text-xs font-black text-gray-800">
            Standard Delivery Message
          </label>
          <textarea
            rows={3}
            value={settings.delivery_message_template}
            onChange={e => setSettings(prev => ({ ...prev, delivery_message_template: e.target.value }))}
            className="w-full p-3 text-xs font-medium text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed"
          />
          <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 text-[11.5px] text-gray-600">
            <span className="font-bold text-gray-500 block mb-0.5">Live Preview:</span>
            &quot;{samplePreviewStandard}&quot;
          </div>
        </div>

        {/* Template 2: Last Day Delivery */}
        <div className="space-y-2">
          <label className="block text-xs font-black text-gray-800">
            Last Day of Cycle Message
          </label>
          <textarea
            rows={3}
            value={settings.last_day_message_template}
            onChange={e => setSettings(prev => ({ ...prev, last_day_message_template: e.target.value }))}
            className="w-full p-3 text-xs font-medium text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none leading-relaxed"
          />
          <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 text-[11.5px] text-gray-600">
            <span className="font-bold text-gray-500 block mb-0.5">Live Preview:</span>
            &quot;{samplePreviewLastDay}&quot;
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="px-5 py-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 stroke-[3]" />
            )}
            <span>{isPending ? 'Saving…' : 'Save Templates'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}