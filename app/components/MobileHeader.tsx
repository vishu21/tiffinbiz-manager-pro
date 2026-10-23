'use client';

import React from 'react';
import { useGlobalSkip } from '@/app/components/GlobalSkipProvider';
import { toLocalDateKey } from '@/app/utils/subscriptionCycle';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const { openSkipModal } = useGlobalSkip();

  return (
    <div className="lg:hidden flex items-center justify-between p-4 bg-brand-sidebar text-[rgb(var(--brand-sidebar-fg))]">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="w-8 h-8 rounded-xl flex items-center justify-center text-[rgb(var(--brand-sidebar-fg))] hover:bg-white/10 transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 6h16M4 12h16M4 18h16"
          ></path>
        </svg>
      </button>
      <h1 className="text-lg font-black tracking-widest text-white">
        TIFFIN<span className="text-brand">OS</span>
      </h1>
      <button
        type="button"
        onClick={() => openSkipModal(undefined, toLocalDateKey(new Date()))}
        title="Quick skip delivery for any customer"
        className="h-8 px-3 text-xs font-bold rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shadow-2xs transition-all duration-150 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      >
        <span className="text-amber-500">⚡</span>
        <span className="hidden sm:inline">Skip Delivery</span>
        <span className="sm:hidden">Skip</span>
      </button>
    </div>
  );
}