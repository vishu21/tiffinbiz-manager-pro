import type { ReactNode } from 'react';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0">
      {/* ── UNIFIED STANDARD PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200/80 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
              System Settings
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
            Configure kitchen departure hub, automated driver messages, routing rules, and your
            brand appearance.
          </p>
        </div>
      </div>

      {/* ── SETTINGS CONTENT ── */}
      <div className="w-full flex-1 flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}