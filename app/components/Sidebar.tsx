'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Utensils, 
  Users, 
  ChefHat, 
  Truck, 
  CalendarOff, 
  CreditCard, 
  Settings,
  MapPin,
  MessageSquare,
  Sliders,
  ChevronDown
} from 'lucide-react';

const navItems = [
  { href: '/admin/customers', label: 'Customers', icon: Users },
  { href: '/admin/recipes', label: 'Recipes', icon: ChefHat },
  { href: '/admin/deliveries', label: 'Deliveries', icon: Truck },
  { href: '/prep', label: 'Kitchen Prep', icon: Utensils },
  { href: '/admin/closures', label: 'Holidays', icon: CalendarOff },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isSettingsActive = pathname.startsWith('/admin/settings');
  const [settingsOpen, setSettingsOpen] = React.useState(true);

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
                onClick={onClose}
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

          {/* Settings Section with Subroutes */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(prev => !prev)}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 group cursor-pointer ${
                isSettingsActive
                  ? 'bg-white/10 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Settings
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    isSettingsActive ? 'text-[#5D5FEF]' : 'text-slate-400 group-hover:text-white'
                  }`}
                  strokeWidth={2}
                />
                <span className="truncate">Settings</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                  settingsOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            {/* Sub-menu links */}
            {settingsOpen && (
              <div className="mt-1 ml-4 pl-3 border-l border-white/10 space-y-1">
                <Link
                  href="/admin/settings/kitchen"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    pathname === '/admin/settings/kitchen'
                      ? 'bg-[#5D5FEF] text-white shadow-md shadow-[#5D5FEF]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Kitchen &amp; Base</span>
                </Link>

                <Link
                  href="/admin/settings/messaging"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    pathname === '/admin/settings/messaging'
                      ? 'bg-[#5D5FEF] text-white shadow-md shadow-[#5D5FEF]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Driver Messaging</span>
                </Link>

                <Link
                  href="/admin/settings/rules"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    pathname === '/admin/settings/rules'
                      ? 'bg-[#5D5FEF] text-white shadow-md shadow-[#5D5FEF]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Plans &amp; Rules</span>
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}