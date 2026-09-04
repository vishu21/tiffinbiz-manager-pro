'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Customers', path: '/admin/customers', icon: '👥' },
    { name: 'Kitchen Prep', path: '/prep', icon: '🍳' },
    { name: 'Dispatch', path: '/dispatch', icon: '🚚' }, // Placeholder for the future
    { name: 'Billing', path: '/billing', icon: '💳' },   // Placeholder for the future
  ];

  return (
    <div className="w-[260px] h-screen bg-[#11142D] text-white flex flex-col shrink-0">
      {/* Brand Logo Area */}
      <div className="px-8 py-6 border-b border-white/10 shrink-0">
        <h1 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
          <span>🍱</span> TIFFIN<span className="text-[#5D5FEF]">OS</span>
        </h1>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.path);
          
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${
                isActive 
                  ? 'bg-[#5D5FEF] text-white shadow-lg shadow-[#5D5FEF]/20' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Profile/Settings Area */}
      <div className="p-4 border-t border-white/10 shrink-0">
        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-all">
          <span>⚙️</span> Settings
        </button>
      </div>
    </div>
  );
}