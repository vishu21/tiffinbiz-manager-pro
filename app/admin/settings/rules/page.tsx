import { Sliders } from 'lucide-react';

export default function RulesSettingsPage() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-4 shadow-2xs">
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
  );
}