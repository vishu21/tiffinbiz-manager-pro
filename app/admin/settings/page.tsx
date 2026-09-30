import { getDriverMessageSettings } from './actions';
import SettingsClient from './SettingsClient';

export const metadata = {
  title: 'Settings · Tiffin OS',
};

export default async function SettingsPage() {
  const initialSettings = await getDriverMessageSettings();

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
            System Settings
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
            Configure automated messages, operations, and business rules.
          </p>
        </div>

        <SettingsClient initialSettings={initialSettings} />
      </div>
    </div>
  );
}