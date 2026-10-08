'use client';

import React from 'react';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <div className="lg:hidden flex items-center justify-between p-4 bg-brand-sidebar text-[rgb(var(--brand-sidebar-fg))]">
      <button onClick={onMenuClick} className="text-[rgb(var(--brand-sidebar-fg))] focus:outline-none">
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
    </div>
  );
}