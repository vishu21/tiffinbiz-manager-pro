'use client';

import React, { useState, useEffect, useRef, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  User,
  CreditCard,
  ChefHat,
  UtensilsCrossed,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { searchGlobal, type SearchResultGroup } from '@/app/admin/actions';

type FlatItem = {
  id: string;
  type: 'customer' | 'recipe' | 'action';
  title: string;
  subtitle: string;
  badge: string;
  badgeBg: string;
  icon: React.ReactNode;
  iconBg: string;
  href: string;
  isCancelled?: boolean;
  isPaused?: boolean;
};

export default function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'paused' | 'cancelled'>('active');
  const [results, setResults] = useState<SearchResultGroup>({ customers: [], recipes: [], actions: [] });
  const [isPending, startTransition] = useTransition();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Open with Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus and initialize on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setStatusFilter('active');
      setSelectedIndex(0);
      startTransition(async () => {
        const initial = await searchGlobal('');
        setResults(initial);
      });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search debounce
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchGlobal(query);
        setResults(res);
        setSelectedIndex(0);
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [query, open]);

  // Filter customers by selected status tab
  const displayedCustomers = useMemo(() => {
    return results.customers.filter(c => {
      if (statusFilter === 'all') return true;
      return c.status === statusFilter;
    });
  }, [results.customers, statusFilter]);

  // Build the unified linear list of items for 100% synchronized arrow navigation
  const flatItems = useMemo<FlatItem[]>(() => {
    const list: FlatItem[] = [];

    // 1. Customer rows
    displayedCustomers.forEach(c => {
      const isCancelled = c.status === 'cancelled';
      const isPaused = c.status === 'paused';

      // Profile Row
      list.push({
        id: `${c.id}-profile`,
        type: 'customer',
        title: c.fullName,
        subtitle: `${c.tier} · 📍 ${c.address.split(',')[0]}`,
        badge: isCancelled ? 'CANCELLED' : isPaused ? 'PAUSED' : 'PROFILE',
        badgeBg: isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' : isPaused ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-gray-100 text-gray-600',
        icon: <User className="w-3.5 h-3.5" />,
        iconBg: isCancelled ? 'bg-rose-50 text-rose-700' : isPaused ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-700',
        href: `/admin/customers?search=${encodeURIComponent(c.fullName)}&id=${c.id}`,
        isCancelled,
        isPaused,
      });

      // Billing Row
      list.push({
        id: `${c.id}-billing`,
        type: 'customer',
        title: `${c.fullName} — Billing & Payments`,
        subtitle: isCancelled ? 'View historical ledger & past invoices' : 'Log payments, balance & WhatsApp receipts',
        badge: 'BILLING',
        badgeBg: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        icon: <CreditCard className="w-3.5 h-3.5" />,
        iconBg: 'bg-emerald-50 text-emerald-700',
        href: `/admin/billing?search=${encodeURIComponent(c.fullName)}&id=${c.id}`,
      });

      // Prep Row (Only if not cancelled)
      if (!isCancelled) {
        list.push({
          id: `${c.id}-prep`,
          type: 'customer',
          title: `${c.fullName} — Kitchen Prep`,
          subtitle: isPaused ? 'Service paused — view profile in prep' : 'Packing order, portion & one-time meal overrides',
          badge: isPaused ? 'PREP (PAUSED)' : 'KITCHEN PREP',
          badgeBg: 'bg-amber-50 text-amber-800 border border-amber-200',
          icon: <ChefHat className="w-3.5 h-3.5" />,
          iconBg: 'bg-amber-50 text-amber-800',
          href: `/prep?customer=${c.id}`,
        });
      }
    });

    // 2. Recipe rows
    results.recipes.forEach(r => {
      list.push({
        id: `recipe-${r.id}`,
        type: 'recipe',
        title: r.name,
        subtitle: 'Recipe formula and ingredient scaling',
        badge: r.category.toUpperCase(),
        badgeBg: 'bg-gray-100 text-gray-600',
        icon: <UtensilsCrossed className="w-3.5 h-3.5" />,
        iconBg: 'bg-emerald-50 text-emerald-700',
        href: `/admin/recipes?search=${encodeURIComponent(r.name)}&id=${r.id}`,
      });
    });

    // 3. Actions / Shortcut rows
    results.actions.forEach(a => {
      list.push({
        id: `action-${a.href}`,
        type: 'action',
        title: a.label,
        subtitle: a.description,
        badge: 'GO TO',
        badgeBg: 'bg-gray-100 text-gray-500',
        icon: <ArrowRight className="w-3.5 h-3.5" />,
        iconBg: 'bg-gray-100 text-gray-700',
        href: a.href,
      });
    });

    return list;
  }, [displayedCustomers, results.recipes, results.actions]);

  // Keep selected index within bounds when the list shrinks
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  // Auto-scroll the active highlighted item into view
  useEffect(() => {
    if (!open) return;
    const activeEl = document.getElementById(`cmd-item-${selectedIndex}`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, open]);

  const handleSelect = (href: string) => {
    setOpen(false);
    router.push(href);
  };

const handleKeyDown = (e: React.KeyboardEvent) => {
    if (flatItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Moving down increases the index
      setSelectedIndex(prev => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Moving up decreases the index
      setSelectedIndex(prev => (prev - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatItems[selectedIndex];
      if (target) handleSelect(target.href);
    }
  };

  if (!open) return null;

  const statusCounts = {
    all: results.customers.length,
    active: results.customers.filter(c => c.status === 'active').length,
    paused: results.customers.filter(c => c.status === 'paused').length,
    cancelled: results.customers.filter(c => c.status === 'cancelled').length,
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-14 sm:pt-20 p-4 bg-black/45 backdrop-blur-xs"
      onKeyDown={handleKeyDown}
    >
      <div className="fixed inset-0" onClick={() => setOpen(false)} />

      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200/90 overflow-hidden flex flex-col max-h-[82vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 bg-white">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search customer, recipe, or shortcut..."
            className="flex-1 text-sm font-semibold text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
          {isPending && <Loader2 className="w-4 h-4 text-[#5D5FEF] animate-spin shrink-0" />}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-gray-400 bg-gray-100 border border-gray-200 rounded-md">
            ESC
          </kbd>
        </div>

        {/* Quick Status Filter Tabs */}
        {results.customers.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-2 bg-gray-50/70 border-b border-gray-100 shrink-0">
            {(
              [
                { key: 'active', label: 'Active', count: statusCounts.active },
                { key: 'all', label: 'All', count: statusCounts.all },
                { key: 'paused', label: 'Paused', count: statusCounts.paused },
                { key: 'cancelled', label: 'Cancelled', count: statusCounts.cancelled },
              ] as const
            ).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.key);
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                className={`px-2.5 py-1 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                  statusFilter === tab.key
                    ? 'bg-white text-[#5D5FEF] border-gray-200 shadow-2xs'
                    : 'bg-transparent border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab.label} <span className="opacity-70 text-[10.5px]">({tab.count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Scrollable Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {flatItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400 font-medium">
              No results found{query ? ` for "${query}"` : ''}.
            </div>
          ) : (
            flatItems.map((item, index) => {
              const isSelected = selectedIndex === index;

              return (
                <div
                  id={`cmd-item-${index}`}
                  key={item.id}
                  onClick={() => handleSelect(item.href)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[#5D5FEF] text-white shadow-2xs'
                      : 'hover:bg-gray-50 text-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : item.iconBg
                      }`}
                    >
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-bold truncate block capitalize ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                          {item.title}
                        </span>
                        {item.isCancelled !== undefined && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              item.isCancelled ? 'bg-rose-500' : item.isPaused ? 'bg-amber-400' : 'bg-emerald-500'
                            }`}
                          />
                        )}
                      </div>
                      <span
                        className={`text-[11px] truncate block ${
                          isSelected ? 'text-white/80' : 'text-gray-400 font-medium'
                        }`}
                      >
                        {item.subtitle}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${
                      isSelected ? 'bg-white/20 text-white' : item.badgeBg
                    }`}
                  >
                    {item.badge}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[11px] text-gray-400 font-medium">
          <span><strong className="text-gray-700">↵ Enter</strong> to open</span>
          <span><strong className="text-gray-700">ESC</strong> to exit</span>
        </div>
      </div>
    </div>
  );
}