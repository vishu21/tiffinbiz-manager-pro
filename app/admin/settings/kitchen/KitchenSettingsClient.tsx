'use client';

import { useState, useTransition } from 'react';
import { 
  Check, 
  Loader2, 
  Search, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  Navigation 
} from 'lucide-react';
import { saveAppSettings, geocodeKitchenAddress, type AppSettingsPayload } from '../actions';
import { useToast } from '@/app/components/ToastProvider';

export default function KitchenSettingsClient({
  initialSettings,
}: {
  initialSettings: AppSettingsPayload;
}) {
  const [settings, setSettings] = useState<AppSettingsPayload>(initialSettings);
  const [savedBaseline, setSavedBaseline] = useState<AppSettingsPayload>(initialSettings);
  /** Bottom-right floating feedback (app/components/ToastProvider.tsx) — replaces
   *  the inline banner that used to push the whole form down on every save. */
  const { showToast } = useToast();
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
      showToast('Could not find GPS coordinates for this address.', 'error');
    }
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveAppSettings(settings);
      if (res.success) {
        setSavedBaseline(settings);
        showToast('Kitchen hub settings saved successfully!');
      } else {
        showToast(res.message || 'Error saving settings', 'error');
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Save / error feedback is a bottom-right floating toast now
          (app/components/ToastProvider.tsx) — nothing is injected above the card,
          so the form never shifts when a save resolves. */}

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-6 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
            Kitchen Departure &amp; Base Hub
          </h3>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            Controls starting and return origins for Google Maps driving routes and route optimization.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
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
                  <span className="text-[10.5px] font-bold text-emerald-700 flex items-center gap-1">
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
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isGeocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Lookup GPS</span>
                </button>
              </div>
            </div>

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
                <div className="mt-2.5 p-3.5 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-wrap items-center gap-4 text-xs">
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