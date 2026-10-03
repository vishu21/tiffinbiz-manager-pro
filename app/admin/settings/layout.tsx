import type { ReactNode } from 'react';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full px-6 sm:px-8 py-6 space-y-6">
      {/* Unified Header */}
      <div className="border-b border-gray-200/80 pb-5">
        <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
          System Settings
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
          Configure kitchen departure hub, automated driver messages, and routing rules.
        </p>
      </div>

      <div className="w-full">
        {children}
      </div>
    </div>
  );
}