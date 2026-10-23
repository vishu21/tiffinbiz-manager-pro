'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBranding } from '@/app/components/ThemeProvider';
import { 
  LayoutDashboard,
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
  Palette,
  ChevronDown,
  Ban
} from 'lucide-react';
import { useGlobalSkip } from '@/app/components/GlobalSkipProvider';
import { toLocalDateKey } from '@/app/utils/subscriptionCycle';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
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

  // White-label identity from the shared branding context (app/components/
  // ThemeProvider.tsx) — a configured logo replaces the stock wordmark.
  const branding = useBranding();
  const logoUrl = (branding?.logo_url ?? '').trim();
  const businessName = (branding?.business_name ?? '').trim() || 'TiffinOS';

  // Centralized skip surface (see app/components/GlobalSkipProvider.tsx) — the
  // global entry point so a skip never has to be recorded from /prep's date-
  // dependent drawer.
  const { openSkipModal } = useGlobalSkip();

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
        className={`fixed inset-y-0 left-0 w-[260px] h-screen bg-brand-sidebar text-[rgb(var(--brand-sidebar-fg))] flex flex-col shrink-0 z-40
          transform transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0`}
      >
        {/* Brand Logo Area */}
        <div className="px-8 py-6 border-b border-[color:var(--brand-sidebar-border)] shrink-0">
          {logoUrl ? (
            <span
              role="img"
              aria-label={businessName}
              title={businessName}
              className="block h-8 w-full max-w-[180px] bg-left bg-contain bg-no-repeat"
              style={{ backgroundImage: `url("${logoUrl}")` }}
            />
          ) : (
            <h1 className="text-lg font-black tracking-tight text-[rgb(var(--brand-sidebar-fg))] flex items-center gap-2 truncate">
              <span className="shrink-0"><Utensils className="w-5 h-5" /></span>
              <span className="truncate">{businessName}</span>
            </h1>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {/* Quick Search Button */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="w-full flex items-center justify-between px-3.5 py-2 mb-2 bg-[color:var(--brand-sidebar-hover)] hover:bg-[color:var(--brand-sidebar-active)] border border-[color:var(--brand-sidebar-border)] rounded-xl text-xs font-semibold text-[rgb(var(--brand-sidebar-fg-soft))] hover:text-[rgb(var(--brand-sidebar-fg))] transition-all shadow-2xs cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <div className="flex items-center gap-2">
              <span className="text-[rgb(var(--brand-sidebar-fg-muted))]">🔍</span>
              <span>Search anything...</span>
            </div>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 border border-white/10 text-[rgb(var(--brand-sidebar-fg-muted))] font-mono">
              ⌘K
            </kbd>
          </button>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/admin/dashboard' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 group cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  isActive
                    ? 'bg-brand text-white shadow-2xs shadow-brand/20'
                    : 'text-[rgb(var(--brand-sidebar-fg-soft))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
                }`}
                onClick={onClose}
              >
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    isActive
                      ? 'text-white'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] group-hover:text-[rgb(var(--brand-sidebar-fg))]'
                  }`}
                  strokeWidth={2}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}

          {/* Global Skip — one action available from every screen, independent of
              the /prep date picker. */}
          <button
            type="button"
            onClick={() => {
              onClose();
              openSkipModal(undefined, toLocalDateKey(new Date()));
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 group text-[rgb(var(--brand-sidebar-fg-soft))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ban
              className="w-[18px] h-[18px] shrink-0 text-[rgb(var(--brand-sidebar-fg-muted))] group-hover:text-[rgb(var(--brand-sidebar-fg))]"
              strokeWidth={2}
            />
            <span className="truncate">Skip Delivery</span>
          </button>

          {/* Settings Section with Subroutes */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(prev => !prev)}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                isSettingsActive
                  ? 'bg-[color:var(--brand-sidebar-active)] text-[rgb(var(--brand-sidebar-fg))]'
                  : 'text-[rgb(var(--brand-sidebar-fg-soft))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Settings
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    isSettingsActive
                      ? 'text-brand'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] group-hover:text-[rgb(var(--brand-sidebar-fg))]'
                  }`}
                  strokeWidth={2}
                />
                <span className="truncate">Settings</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-[rgb(var(--brand-sidebar-fg-muted))] transition-transform duration-200 ${
                  settingsOpen ? 'rotate-180 text-[rgb(var(--brand-sidebar-fg))]' : ''
                }`}
              />
            </button>

            {/* Sub-menu links */}
            {settingsOpen && (
              <div className="mt-1 ml-4 pl-3 border-l border-[color:var(--brand-sidebar-border)] space-y-1">
                <Link
                  href="/admin/settings/kitchen"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    pathname === '/admin/settings/kitchen'
                      ? 'bg-brand text-white shadow-2xs shadow-brand/20'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Kitchen &amp; Base</span>
                </Link>

                <Link
                  href="/admin/settings/messaging"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    pathname === '/admin/settings/messaging'
                      ? 'bg-brand text-white shadow-2xs shadow-brand/20'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Messaging & Templates</span>
                </Link>

                <Link
                  href="/admin/settings/rules"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    pathname === '/admin/settings/rules'
                      ? 'bg-brand text-white shadow-2xs shadow-brand/20'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Plans &amp; Rules</span>
                </Link>

                <Link
                  href="/admin/settings/branding"
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    pathname === '/admin/settings/branding'
                      ? 'bg-brand text-white shadow-2xs shadow-brand/20'
                      : 'text-[rgb(var(--brand-sidebar-fg-muted))] hover:text-[rgb(var(--brand-sidebar-fg))] hover:bg-[color:var(--brand-sidebar-hover)]'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Branding &amp; Appearance</span>
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}