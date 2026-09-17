'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Utensils, Users, ChefHat, Truck, CalendarOff, CreditCard, Settings, Calendar } from 'lucide-react';

// Static navigation — identical on every server and client render pass.
const navItems = [
  { href: '/admin/customers', label: 'Customers', icon: Users },
  { href: '/admin/recipes', label: 'Recipes', icon: ChefHat },
  { href: '/admin/deliveries', label: 'Deliveries', icon: Truck },
  { href: '/prep', label: 'Kitchen Prep', icon: Utensils },
  { href: '/admin/closures', label: 'Holidays', icon: CalendarOff },
  { href: '/billing', label: 'Billing', icon: CreditCard },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
        ></div>
      )}

      <div
        className={`fixed inset-y-0 left-0 w-[260px] h-screen bg-[#11142D] text-white flex flex-col shrink-0 z-40
          transform transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0`}
      >
        {/* Brand Logo Area */}
        <div className="px-8 py-6 border-b border-white/10 shrink-0">
          <h1 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
            <span><Utensils className="w-5 h-5" /></span> TIFFIN<span className="text-[#5D5FEF]">OS</span>
          </h1>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Active state only affects styling classes — href & content stay identical.
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 group ${
                  isActive
                    ? 'bg-[#5D5FEF] text-white shadow-lg shadow-[#5D5FEF]/20'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
                onClick={onClose} // Close sidebar on navigation
              >
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                  }`}
                  strokeWidth={2}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Profile/Settings Area */}
        <div className="p-4 border-t border-white/10 shrink-0">
          <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-all group">
            <Settings className="w-[18px] h-[18px] shrink-0 text-slate-400 group-hover:text-white transition-colors" strokeWidth={2} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </>
  );
}
