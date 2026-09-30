'use client';

import { useState, useTransition } from 'react';
import { 
  MapPin, 
  MessageSquare, 
  Check, 
  AlertCircle, 
  Loader2, 
  Search, 
  Sliders,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Navigation
} from 'lucide-react';
import { saveAppSettings, geocodeKitchenAddress, type AppSettingsPayload } from './actions';
import { formatDeliveryMessage } from '@/app/utils/messageTemplate';

type SettingsTab = 'kitchen' | 'messaging' | 'subscriptions';

export default function SettingsClient({
  initialSettings,
}: {
  initialSettings: AppSettingsPayload;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('kitchen');
  const [settings, setSettings] = useState<AppSettingsPayload>(initialSettings);
  const [savedBaseline, setSavedBaseline] = useState<AppSettingsPayload>(initialSettings);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeSuccess, setGeocodeSuccess] = useState(false);
  const [showAdvancedGps, setShowAdvancedGps] = useState(false);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedBaseline);

  const handleLookupCoordinates = async () => {
    if (!settings.kitchen_address.trim()) return;
    setIsGeocoding(true);
    setGeocodeSuccess(false);
    const coords = await geocodeKitchenAddress(settings.kitchen_address);
    setIsGeocoding(false);
    if (coords) {
      setSettings(prev => ({
        ...prev,
        kitchen_lat: coords.lat,
        kitchen_lng: coords.lng,
      }));
      setGeocodeSuccess(true);
      setTimeout(() => setGeocodeSuccess(false), 3500);
    } else {
      setErrorMsg('Could not find GPS coordinates for this address.');
    }
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
    <div className="space-y-4">
      {/* Toast Feedback */}
      {status === 'saved' && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Settings saved successfully and active across all dispatch routes!</span>
        </div>
      )}

      {status === 'error' && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Settings Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden flex flex-col md:flex-row">
        
        {/* Left Vertical Sub-Navigation */}
        <div className="w-full md:w-60 bg-gray-50/60 border-b md:border-b-0 md:border-r border-gray-200 p-3 space-y-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('kitchen')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === 'kitchen'
                ? 'bg-white text-[#5D5FEF] shadow-xs border-l-4 border-[#5D5FEF]'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/70'
            }`}
          >
            <MapPin className="w-4 h-4 shrink-0" />
            <span>Kitchen &amp; Dispatch</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('messaging')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === 'messaging'
                ? 'bg-white text-[#5D5FEF] shadow-xs border-l-4 border-[#5D5FEF]'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/70'
            }`}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Driver Messaging</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === 'subscriptions'
                ? 'bg-white text-[#5D5FEF] shadow-xs border-l-4 border-[#5D5FEF]'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/70'
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span>Plans &amp; Rules</span>
          </button>
        </div>

        {/* Right Active Panel Content */}
        <div className="flex-1 p-6 sm:p-8 flex flex-col justify-between">
          <div>
            {/* ================= TAB 1: KITCHEN & DISPATCH ================= */}
            {activeTab === 'kitchen' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                    Kitchen Departure &amp; Base Hub
                  </h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">
                    Controls starting and return origins for Google Maps driving routes and route optimization.
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                  {/* Form Inputs (8 Columns) */}
                  <div className="xl:col-span-8 space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-gray-700">Hub / Kitchen Name</label>
                      <input
                        type="text"
                        value={settings.kitchen_name}
                        onChange={e => setSettings(prev => ({ ...prev, kitchen_name: e.target.value }))}
                        className="w-full px-3.5 py-2.5 text-xs font-semibold text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-gray-700">Physical Origin Address</label>
                        {geocodeSuccess && (
                          <span className="text-[10.5px] font-bold text-emerald-700 flex items-center gap-1 animate-in fade-in">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Coordinates Updated
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={settings.kitchen_address}
                          onChange={e => setSettings(prev => ({ ...prev, kitchen_address: e.target.value }))}
                          className="flex-1 min-w-0 px-3.5 py-2.5 text-xs font-semibold text-gray-800 border border-gray-200 rounded-xl focus:border-[#5D5FEF] outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleLookupCoordinates}
                          disabled={isGeocoding}
                          className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {isGeocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          <span>Lookup GPS</span>
                        </button>
                      </div>
                    </div>

                    {/* Advanced Coordinates Accordion */}
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedGps(prev => !prev)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-bold text-gray-400 hover:text-gray-700 cursor-pointer"
                      >
                        <span>{showAdvancedGps ? 'Hide GPS Coordinates' : 'Show Advanced GPS Coordinates'}</span>
                        {showAdvancedGps ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {showAdvancedGps && (
                        <div className="mt-2.5 p-3.5 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-wrap items-center gap-4 text-xs animate-in fade-in">
                          <span className="font-bold text-gray-500 uppercase text-[10px] tracking-wider">
                            GPS Origin:
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-mono">Lat:</span>
                            <input
                              type="number"
                              step="0.0001"
                              value={settings.kitchen_lat}
                              onChange={e => setSettings(prev => ({ ...prev, kitchen_lat: parseFloat(e.target.value) || 0 }))}
                              className="w-28 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-mono">Lng:</span>
                            <input
                              type="number"
                              step="0.0001"
                              value={settings.kitchen_lng}
                              onChange={e => setSettings(prev => ({ ...prev, kitchen_lng: parseFloat(e.target.value) || 0 }))}
                              className="w-28 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hub Route Status Card (4 Columns) */}
                  <div className="xl:col-span-4 bg-gradient-to-br from-gray-50 to-indigo-50/40 rounded-2xl border border-gray-200/90 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5 text-[#5D5FEF]" /> Hub Route Status
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Active Base
                      </span>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-gray-100 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">Departure Point</span>
                      <p className="text-xs font-black text-gray-900">{settings.kitchen_name || 'Kitchen Hub'}</p>
                      <p className="text-[11px] text-gray-500 leading-snug break-words">{settings.kitchen_address || 'No address set'}</p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-mono bg-white/70 px-3 py-2 rounded-lg border border-gray-100">
                      <span>Coordinates:</span>
                      <strong className="text-gray-800 font-sans">{settings.kitchen_lat.toFixed(4)}, {settings.kitchen_lng.toFixed(4)}</strong>
                    </div>

                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.kitchen_address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full h-8 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                      <span>Preview in Google Maps</span>
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 2: DRIVER MESSAGING ================= */}
            {activeTab === 'messaging' && (
              <div className="space-y-6">
                <div>
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
                      { tag: '{customer_name}', label: 'Customer Name' },
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

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Standard Message */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-gray-900 tracking-tight">
                        Standard Delivery Message
                      </label>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Routine Stop
                      </span>
                    </div>

                    <textarea
                      rows={4}
                      value={settings.delivery_message_template}
                      onChange={e => setSettings(prev => ({ ...prev, delivery_message_template: e.target.value }))}
                      className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-[#5D5FEF] focus:ring-2 focus:ring-[#5D5FEF]/10 outline-none leading-relaxed transition-all shadow-2xs"
                      placeholder="Enter regular delivery message..."
                    />

                    {/* Standard Live Preview Bubble */}
                    <div className="p-3.5 bg-emerald-50/70 rounded-xl border border-emerald-200/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-black tracking-wider text-emerald-800 uppercase">
                        <span>💬 WhatsApp Preview</span>
                        <span className="font-normal opacity-70">Customer view</span>
                      </div>
                      <p className="text-xs font-medium text-emerald-950 leading-relaxed italic">
                        &quot;{samplePreviewStandard}&quot;
                      </p>
                    </div>
                  </div>

                  {/* Last Day Message */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-gray-900 tracking-tight">
                        Final Day of Cycle Message
                      </label>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                        Cycle Renewal
                      </span>
                    </div>

                    <textarea
                      rows={4}
                      value={settings.last_day_message_template}
                      onChange={e => setSettings(prev => ({ ...prev, last_day_message_template: e.target.value }))}
                      className="w-full p-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10 outline-none leading-relaxed transition-all shadow-2xs"
                      placeholder="Enter cycle expiration message..."
                    />

                    {/* Last Day Live Preview Bubble */}
                    <div className="p-3.5 bg-rose-50/70 rounded-xl border border-rose-200/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-black tracking-wider text-rose-800 uppercase">
                        <span>⚠️ Final Delivery Alert Preview</span>
                        <span className="font-normal opacity-70">Customer view</span>
                      </div>
                      <p className="text-xs font-medium text-rose-950 leading-relaxed italic">
                        &quot;{samplePreviewLastDay}&quot;
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 3: SUBSCRIPTIONS & RULES ================= */}
            {activeTab === 'subscriptions' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                    Subscription &amp; Logistics Rules
                  </h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">
                    Configure standard defaults for subscriber cycles, grace windows, and delivery patterns.
                  </p>
                </div>

                <div className="p-12 text-center border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/40">
                  <Sliders className="w-9 h-9 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-gray-600">Plans &amp; Logistics Module Ready</p>
                  <p className="text-[11px] text-gray-400 mt-1 max-w-sm mx-auto">
                    We will configure plan credit defaults (Weekly: 5, Monthly: 20), grace periods, and non-veg delivery days here.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Sticky Bottom Action Footer */}
          <div className="pt-6 mt-8 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {isDirty ? (
                <span className="text-amber-600 font-bold">● Unsaved changes pending</span>
              ) : (
                'All settings up to date'
              )}
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
                className="px-5 py-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[3]" />}
                <span>{isPending ? 'Saving…' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}