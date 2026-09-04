'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { fetchDailyMenu, saveDailyMenu, getAvailableRecipes } from './actions';
import type { Recipe } from './actions';
import RecipeManagerModal from './RecipeManagerModal';

type Customer = {
  id: string;
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  meal_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  rice_count?: string | null;
  delivery_schedule?: string | null;
  subscription_status?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  created_at: string;
};

const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

export default function PrepDashboardClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Derive the active day name from the selected date
  const activeDay = DAYS_OF_WEEK[(selectedDate.getDay() + 6) % 7];

  const [vegOption1, setVegOption1] = useState<string>('');
  const [vegOption2, setVegOption2] = useState<string>('');
  const [chickenOption, setChickenOption] = useState<string>('Chicken Curry');
  const [isMenuLoading, setIsMenuLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [availableRecipes, setAvailableRecipes] = useState<{ dal: Recipe[]; sabji: Recipe[] }>({ dal: [], sabji: [] });
  const [showRecipeManager, setShowRecipeManager] = useState(false);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveInFlightRef = useRef(false);

  // Format selectedDate as YYYY-MM-DD for DB queries
  const dateStr = selectedDate.toISOString().split('T')[0];

  // Fetch menu from Supabase whenever selectedDate changes
  useEffect(() => {
    let cancelled = false;
    setIsMenuLoading(true);
    setSyncStatus('idle');

    (async () => {
      try {
        const data = await fetchDailyMenu(dateStr);
        if (cancelled) return;
        if (data) {
          setVegOption1(data.veg_option_1);
          setVegOption2(data.veg_option_2);
          setChickenOption(data.chicken_option || 'Chicken Curry');
        } else {
          setVegOption1('');
          setVegOption2('');
          setChickenOption('Chicken Curry');
        }
      } catch (err) {
        console.error('Failed to load daily menu:', err);
      } finally {
        if (!cancelled) setIsMenuLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dateStr]);

  // Debounced auto-save: save 1.2s after last change
  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSyncStatus('saving');

    saveTimerRef.current = setTimeout(async () => {
      if (saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      try {
        await saveDailyMenu(dateStr, {
          veg_option_1: vegOption1,
          veg_option_2: vegOption2,
          chicken_option: chickenOption,
        });
        setSyncStatus('saved');
      } catch {
        setSyncStatus('error');
      } finally {
        saveInFlightRef.current = false;
      }
    }, 1200);
  }, [dateStr, vegOption1, vegOption2, chickenOption]);

  // Call triggerAutoSave whenever any menu value changes
  useEffect(() => {
    if (!isMenuLoading) triggerAutoSave();
  }, [vegOption1, vegOption2, chickenOption, isMenuLoading]);

  const refreshRecipes = useCallback(async () => {
    try {
      const recipes = await getAvailableRecipes();
      setAvailableRecipes(recipes);
    } catch (err) {
      console.error('[Prep] Failed to reload recipes:', err);
    }
  }, []);

  // Fetch available recipes on mount
  useEffect(() => {
    refreshRecipes();
  }, [refreshRecipes]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Helper: shift selectedDate to a specific day of the week
  const goToDay = (targetDayName: string) => {
    const targetIndex = DAYS_OF_WEEK.indexOf(targetDayName);
    if (targetIndex === -1) return;
    // DAYS_OF_WEEK[0]=Monday → JS getDay(): Mon=1, Tue=2, ..., Sun=0
    const jsTargetDay = targetIndex < 6 ? targetIndex + 1 : 0;
    const diff = jsTargetDay - selectedDate.getDay();
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + diff);
    setSelectedDate(newDate);
  };

  const isChickenDay = useMemo(() => {
    return ['Monday', 'Wednesday', 'Friday'].includes(activeDay);
  }, [activeDay]);

  // --- ENGINE 1: DELIVERY FILTER ---
  const activeCustomers = useMemo(() => {
    return initialCustomers.filter(customer => {
      const schedule = customer.delivery_schedule || '';
      if (!schedule || schedule === '—') return false;

      // Subscription status filtering
      const subStatus = (customer.subscription_status || 'active').toLowerCase();
      if (subStatus === 'cancelled') return false;
      if (subStatus === 'paused') {
        if (!customer.pause_start_date) return false; // Indefinitely paused
        const today = new Date().toISOString().split('T')[0];
        if (today >= customer.pause_start_date) {
          if (!customer.pause_end_date || today <= customer.pause_end_date) {
            return false; // Within pause window
          }
        }
      }

      const shortDay = activeDay.substring(0, 3); 
      
      const exceptionMatch = schedule.match(/\[EXCEPT:(.*?)\]/i);
      if (exceptionMatch) {
        const exceptionString = exceptionMatch[1];
        if (exceptionString.includes(shortDay)) return false; 
      }

      const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(activeDay);
      if (schedule.includes('Monday to Friday') && isWeekday) {
        return true;
      }

      if (schedule.includes(activeDay) || schedule.includes(shortDay)) {
        return true;
      }

      return false;
    });
  }, [initialCustomers, activeDay]);


  // ═══════════════════════════════════════════════════════════════════
  // ENGINE 2: PREP METRICS — Strict Veg Day / Non-Veg Day Matrices
  // ═══════════════════════════════════════════════════════════════════
  const metrics = useMemo(() => {
    let totalRoti = 0;
    let totalChickenLegs = 0;
    let totalDalOunces = 0;
    let totalSabjiOunces = 0;
    let chickenCurryOunceTarget = 0;

    const breakdowns = {
      veg: { Small: 0, Regular: 0, Large: 0, CurryOnly: 0 },
      nonVeg: { Small: 0, Regular: 0, Large: 0, CurryOnly: 0 }
    };

    const rice = { rg: 0, lg: 0, xl: 0 };
    const isVegDay = !isChickenDay;

    const parseInstructions = (instructionStr: string | null) => {
      const lower = (instructionStr || '').toLowerCase();
      const extractCount = (keyword: string): number => {
        const match = lower.match(new RegExp(`(\\d+)\\s*${keyword}`));
        return match ? parseInt(match[1], 10) : 0;
      };
      return {
        dal: extractCount('dal'),
        sabji: extractCount('sabji'),
        gravy: extractCount('gravy'),
        chicken: extractCount('chicken'),
      };
    };

    activeCustomers.forEach(customer => {
      if (customer.roti_count) totalRoti += customer.roti_count;

      const isNonVeg = (customer.meal_type || '').toLowerCase().includes('non');
      const rawPortion = (customer.portion_size || '').toLowerCase().trim();
      let portion: 'Small' | 'Regular' | 'Large' = 'Regular';
      if (rawPortion === 'sm' || rawPortion === 'small') portion = 'Small';
      else if (rawPortion === 'lg' || rawPortion === 'large') portion = 'Large';

      // ── Track breakdowns ──
      if (isNonVeg) breakdowns.nonVeg[portion]++;
      else breakdowns.veg[portion]++;

      // Unpack the true food counts from the database instructions string
      const sides = parseInstructions(customer.delivery_instructions);

      if (isVegDay) {
        // ═══════════════════════════════════════════════
        // VEG DAY — ALL customers routed to Veg pool
        // Chicken = 0, Legs = 0
        // ═══════════════════════════════════════════════
        if (portion === 'Small') {
          totalSabjiOunces += 8;
        } else {
          const oz = portion === 'Large' ? 12 : 8;
          totalDalOunces += oz;
          totalSabjiOunces += oz;
        }
      } else {
        // ═══════════════════════════════════════════════
        // NON-VEG DAY — Property-driven multiplier matrix
        // ═══════════════════════════════════════════════
        const isLarge = portion === 'Large';
        const multiplier = isLarge ? 12 : 8;
        const legsPerChicken = isLarge ? 2 : 1;

        if (!isNonVeg) {
          // ── Veg Profile ──
          if (portion === 'Small') {
            totalSabjiOunces += 8;
          } else {
            const isVegEmpty = sides.dal === 0 && sides.sabji === 0;
            const finalDal = isVegEmpty ? 1 : sides.dal;
            const finalSabji = isVegEmpty ? 1 : sides.sabji;
            totalDalOunces += finalDal * multiplier;
            totalSabjiOunces += finalSabji * multiplier;
          }
        } else {
          // ── Non-Veg Profile ──
          if (portion === 'Small') {
            // SM Non-Veg: exactly 1 container (8 oz)
            chickenCurryOunceTarget += 8;
            // Default to 1 leg unless explicitly flagged as gravy only
            if (sides.chicken > 0 || (sides.chicken === 0 && sides.gravy === 0)) {
              totalChickenLegs += 1;
            }
          } else {
            // Regular & Large Non-Veg Tiffins
            const hasNoChickenOrGravy = sides.chicken === 0 && sides.gravy === 0;

            const finalChicken = hasNoChickenOrGravy ? 1 : sides.chicken;
            const finalGravy = sides.gravy;
            // Non-veg meals include 1 Dal container on chicken days when the profile requests it.
            const finalDal = sides.dal > 0 ? sides.dal : 0;

            // Sabji fills whatever container slots remain (2 containers max).
            // e.g. 1 Dal + 1 Chicken → Dal + Chicken (no sabji);
            //      legacy 1 Sabji + 1 Chicken (no Dal) → Chicken + Sabji.
            const usedSlots = finalDal + finalChicken + finalGravy;
            const finalSabji = hasNoChickenOrGravy
              ? (sides.dal > 0 ? 0 : 1)
              : Math.max(0, 2 - usedSlots);

            totalDalOunces += finalDal * multiplier;
            totalSabjiOunces += finalSabji * multiplier;
            chickenCurryOunceTarget += (finalChicken + finalGravy) * multiplier;
            totalChickenLegs += finalChicken * legsPerChicken;
          }
        }
      }

      // ── Rice aggregation (unchanged) ──
      if (customer.rice_count && customer.rice_count !== 'None' && customer.rice_count !== '—') {
        customer.rice_count.split('+').forEach(token => {
          const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/);
          if (m) {
            const qty = parseInt(m[1], 10);
            const size = m[2] as 'rg' | 'lg' | 'xl';
            rice[size] += qty;
          }
        });
      }
    });

    // On Veg Days, redirect all meal counts to Veg card
    if (isVegDay) {
      breakdowns.veg.Small += breakdowns.nonVeg.Small;
      breakdowns.veg.Regular += breakdowns.nonVeg.Regular;
      breakdowns.veg.Large += breakdowns.nonVeg.Large;
      breakdowns.veg.CurryOnly += breakdowns.nonVeg.CurryOnly;
      breakdowns.nonVeg.Small = 0;
      breakdowns.nonVeg.Regular = 0;
      breakdowns.nonVeg.Large = 0;
      breakdowns.nonVeg.CurryOnly = 0;
    }

    const totalVeg = breakdowns.veg.Small + breakdowns.veg.Regular + breakdowns.veg.Large + breakdowns.veg.CurryOnly;
    const totalNonVeg = breakdowns.nonVeg.Small + breakdowns.nonVeg.Regular + breakdowns.nonVeg.Large + breakdowns.nonVeg.CurryOnly;
    const totalMeals = activeCustomers.length;
    const totalRiceContainers = rice.rg + rice.lg + rice.xl;

    return {
      totalRoti,
      totalChickenLegs,
      breakdowns,
      totalVeg,
      totalNonVeg,
      totalDalOunces,
      totalSabjiOunces,
      chickenCurryOunceTarget,
      totalMeals,
      rice,
      totalRiceContainers,
    };
  }, [activeCustomers, isChickenDay]);


  return (
    <div className="flex flex-col h-screen bg-[#F9FBFC] overflow-hidden font-sans text-[#292D32]">
      
      {/* HEADER SECTION */}
      <div className="bg-white border-b border-[#EEEEEE] shrink-0">
        <div className="px-8 py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold text-[#11142D]">Kitchen Prep Dashboard</h1>
              <span className="px-3 py-1 rounded-md text-[11px] font-black bg-gray-100 text-gray-700 border border-gray-200 uppercase tracking-wider">
                🚚 {metrics.totalMeals} deliveries
              </span>
              <span className="text-base text-gray-500 font-semibold border-l border-gray-200 pl-3">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
            </div>
            <p className="text-[13px] text-gray-500 mt-1">Real-time production metrics for line chefs.</p>
          </div>
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 rounded-md text-[11px] font-black tracking-wider uppercase border shadow-sm ${
              isChickenDay 
                ? 'bg-red-600 text-white border-red-700 animate-pulse' 
                : 'bg-green-600 text-white border-green-700'
            }`}>
              {isChickenDay ? '🍗 Non-Veg Day' : '🥬 Veg Day'}
            </span>

            <div className="flex bg-[#F4F4FE] p-1 rounded-lg border border-[#EFEEFC]">
              {DAYS_OF_WEEK.map(day => (
                <button
                  key={day}
                  onClick={() => goToDay(day)}
                  className={`px-4 py-1.5 text-[12px] font-bold rounded-md transition-all ${
                    activeDay === day 
                      ? 'bg-[#5D5FEF] text-white shadow-sm' 
                      : 'text-[#7A7C87] hover:text-[#5D5FEF] hover:bg-white/50'
                  }`}
                >
                  {day.substring(0, 3)}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={selectedDate.toISOString().split('T')[0]}
              onChange={(e) => {
                const picked = new Date(e.target.value + 'T12:00:00');
                if (!isNaN(picked.getTime())) setSelectedDate(picked);
              }}
              className="px-2 py-1.5 text-[12px] font-semibold bg-white border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-gray-700 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* DASHBOARD GRID WORKSPACE */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        
        {/* 4-COLUMN METRICS ROW */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          
          {/* Card 1+2: Carbs & Menu Board (merged) */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-[#EEEEEE] shadow-sm p-5 flex flex-col lg:flex-row gap-6 min-h-[175px]">
            {/* LEFT PANEL: CARBS METRICS */}
            <div className="flex-1 flex gap-6 items-center border-b lg:border-b-0 lg:border-r border-gray-100 pb-4 lg:pb-0 lg:pr-6">
              {/* Roti Section */}
              <div className="w-1/3 flex flex-col justify-start h-full">
                <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">Roti</span>
                <div className="text-[36px] font-black text-amber-600 mt-1 leading-none">{metrics.totalRoti}</div>
              </div>

              {/* Rice Matrix Section */}
              <div className="flex-1 flex flex-col justify-start h-full">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">Rice</span>
                  <span className="text-[10.5px] font-bold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-md uppercase tracking-wider">{metrics.totalRiceContainers} Boxes</span>
                </div>
                <div className="space-y-1">
                  {[
                    { label: 'XL', key: 'xl' as const },
                    { label: 'LG', key: 'lg' as const },
                    { label: 'RG', key: 'rg' as const },
                  ].map(item => {
                    const count = metrics.rice[item.key];
                    return (
                      <div key={item.key} className={`flex items-center gap-2 ${count === 0 ? 'opacity-30' : ''}`}>
                        <span className="text-[13px] font-bold text-gray-500 w-6 shrink-0">{item.label}</span>
                        <span className="text-[13px] font-black text-gray-800">{count}</span>
                        <span className="text-[11px] text-gray-400 font-medium">× {item.label} Box</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: TODAY'S MENU INPUTS */}
            <div className="flex-1 flex flex-col justify-start gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">Today's Production Menu</span>
                  <button
                    onClick={() => setShowRecipeManager(true)}
                    className="text-[11px] text-gray-400 hover:text-[#5D5FEF] transition-colors font-medium"
                    title="Manage Recipes"
                  >
                    ⚙️
                  </button>
                </div>
                <span className="text-[10px] font-semibold flex items-center gap-1">
                  {isMenuLoading ? (
                    <span className="text-gray-400 animate-pulse">⏳ Loading...</span>
                  ) : syncStatus === 'saving' ? (
                    <span className="text-amber-500">⏳ Saving...</span>
                  ) : syncStatus === 'saved' ? (
                    <span className="text-emerald-600">✓ Saved</span>
                  ) : syncStatus === 'error' ? (
                    <span className="text-red-500">✗ Save Error</span>
                  ) : null}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded uppercase w-14 text-center shrink-0">Veg 1</span>
                  <select
                    value={vegOption1}
                    onChange={(e) => setVegOption1(e.target.value)}
                    disabled={isMenuLoading}
                    className="flex-1 text-[12px] px-2 py-1 bg-gray-50 border border-gray-200 rounded outline-none focus:bg-white focus:border-green-500 text-gray-700 font-medium disabled:opacity-40 disabled:cursor-wait appearance-none cursor-pointer"
                  >
                    <option value="">— Select Dal —</option>
                    {availableRecipes.dal.map(r => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded uppercase w-14 text-center shrink-0">Veg 2</span>
                  <select
                    value={vegOption2}
                    onChange={(e) => setVegOption2(e.target.value)}
                    disabled={isMenuLoading}
                    className="flex-1 text-[12px] px-2 py-1 bg-gray-50 border border-gray-200 rounded outline-none focus:bg-white focus:border-emerald-500 text-gray-700 font-medium disabled:opacity-40 disabled:cursor-wait appearance-none cursor-pointer"
                  >
                    <option value="">— Select Sabji —</option>
                    {availableRecipes.sabji.map(r => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded uppercase w-14 text-center shrink-0">Non-Veg</span>
                  <input type="text" value={chickenOption} onChange={(e) => setChickenOption(e.target.value)} placeholder="Chicken Curry" disabled={isMenuLoading} className="flex-1 text-[12px] px-2 py-1 bg-gray-50 border border-gray-200 rounded outline-none focus:bg-white focus:border-red-500 text-gray-700 font-medium disabled:opacity-40 disabled:cursor-wait" />
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Vegetarian Meals — Cooking Volume First */}
          <div className="bg-white p-3.5 rounded-xl border border-[#EEEEEE] shadow-sm flex flex-col relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-green-500" />
            <div className="flex items-stretch h-full">
              {/* LEFT: Cooking Volume (Ounces) */}
              <div className="flex-1 flex flex-col justify-start pr-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">🥬 Veg Station</span>
                <div className="mt-1 space-y-1">
                  <div className={`text-[26px] font-black leading-none ${metrics.totalSabjiOunces > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                    {metrics.totalSabjiOunces} <span className="text-[16px] font-bold">oz Sabji</span>
                  </div>
                  <div className={`text-[26px] font-black leading-none ${metrics.totalDalOunces > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                    {metrics.totalDalOunces} <span className="text-[16px] font-bold">oz Dal</span>
                  </div>
                </div>
              </div>
              {/* RIGHT: Packing Matrix */}
              <div className="shrink-0 w-[100px] bg-gray-50/80 rounded-lg p-2 flex flex-col justify-center border border-gray-100">
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1 text-center">Pack</span>
                <div className="space-y-1">
                  {[
                    { label: 'LG', count: metrics.breakdowns.veg.Large },
                    { label: 'RG', count: metrics.breakdowns.veg.Regular },
                    { label: 'SM', count: metrics.breakdowns.veg.Small },
                  ].map(row => (
                    <div key={row.label} className={`flex items-center justify-between text-[12px] ${row.count === 0 ? 'opacity-30' : ''}`}>
                      <span className="font-bold text-gray-500">{row.label}</span>
                      <span className="font-black text-gray-800">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Non-Vegetarian Meals — Cooking Volume First */}
          <div className="bg-white p-3.5 rounded-xl border border-[#EEEEEE] shadow-sm flex flex-col relative overflow-hidden bg-red-50/10">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500" />
            <div className="flex items-stretch h-full">
              {/* LEFT: Prep Counts (Ounces + Legs) */}
              <div className="flex-1 flex flex-col justify-start pr-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">🍗 Chicken Station</span>
                <div className="mt-1 space-y-1">
                  <div className={`text-[26px] font-black leading-none ${metrics.chickenCurryOunceTarget > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                    {metrics.chickenCurryOunceTarget} <span className="text-[16px] font-bold">oz Chicken</span>
                  </div>
                  {isChickenDay && metrics.totalChickenLegs > 0 ? (
                    <span className="inline-block bg-red-600 text-white px-3 py-1 rounded-md text-[15px] font-black tracking-wider border border-red-700 shadow-md">
                      🍗 {metrics.totalChickenLegs} LEGS
                    </span>
                  ) : (
                    <span className="inline-block text-[13px] font-bold text-gray-300">🥬 Chicken Idle</span>
                  )}
                </div>
              </div>
              {/* RIGHT: Packing Matrix */}
              <div className="shrink-0 w-[100px] bg-gray-50/80 rounded-lg p-2 flex flex-col justify-center border border-gray-100">
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1 text-center">Pack</span>
                <div className="space-y-1">
                  {[
                    { label: 'LG', count: metrics.breakdowns.nonVeg.Large },
                    { label: 'RG', count: metrics.breakdowns.nonVeg.Regular },
                    { label: 'SM', count: metrics.breakdowns.nonVeg.Small },
                  ].map(row => (
                    <div key={row.label} className={`flex items-center justify-between text-[12px] ${row.count === 0 ? 'opacity-30' : ''}`}>
                      <span className="font-bold text-gray-500">{row.label}</span>
                      <span className="font-black text-gray-800">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FULL-WIDTH PACKING MANIFEST */}
        <div className="bg-white border border-[#EEEEEE] rounded-xl shadow-sm overflow-hidden w-full">
          <div className="px-5 py-3 border-b border-[#F5F5F5] bg-[#FCFCFD] flex justify-between items-center">
            <h3 className="text-[12px] font-bold text-[#11142D] uppercase tracking-wide">Kitchen Packing Manifest</h3>
            <button onClick={() => window.print()} className="text-[11.5px] font-bold text-[#5D5FEF] bg-[#F4F4FE] border border-[#EFEEFC] px-3 py-1 rounded-md hover:bg-[#5D5FEF] hover:text-white transition-all">
              🖨️ Print Checklist
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[#A2A4B0] font-bold border-b border-[#F5F5F5] uppercase text-[10.5px] tracking-wider bg-gray-50/60 h-9">
                  <th className="pl-5">Customer</th>
                  <th>Type</th>
                  <th>Portion</th>
                  <th>Roti</th>
                  <th>Rice</th>
                  <th className="pr-5">Side Instructions / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F6F6F6]">
                {activeCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400 font-medium">No active kitchen deliveries routed for {activeDay}.</td>
                  </tr>
                ) : (
                  activeCustomers.map(customer => (
                    <tr key={customer.id} className="hover:bg-[#FAF9FF] transition-colors h-11">
                      <td className="pl-5 font-bold text-[#11142D] text-[13.5px]">{customer.full_name}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded text-[10.5px] font-black tracking-wide border uppercase ${
                          customer.meal_type?.toLowerCase().includes('non') 
                            ? 'bg-red-50 text-red-600 border-red-100' 
                            : 'bg-green-50 text-green-600 border-green-100'
                        }`}>
                          {customer.meal_type?.toLowerCase().includes('non') ? 'Non-Veg' : 'Veg'}
                        </span>
                      </td>
                      <td className="font-bold text-gray-700 uppercase text-[12px]">
                        {customer.portion_size || 'Regular'} 
                        <span className="text-[10px] text-gray-400 font-medium ml-1">
                          ({customer.portion_size?.toLowerCase() === 'large' ? '2x 12oz' : customer.portion_size?.toLowerCase() === 'small' || customer.portion_size?.toLowerCase() === 'sm' ? '1x 8oz' : '2x 8oz'})
                        </span>
                      </td>
                      <td className="font-black text-amber-700 text-sm font-mono">{customer.roti_count ? `${customer.roti_count}x` : '—'}</td>
                      <td className="font-mono text-blue-700 font-bold uppercase text-[12px]">{customer.rice_count && customer.rice_count !== 'None' && customer.rice_count !== '—' ? customer.rice_count : ''}</td>
                      <td className="pr-5 text-gray-500 font-medium text-[12px] truncate max-w-[300px]" title={customer.dietary_notes || ''}>{customer.dietary_notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
      <RecipeManagerModal
        open={showRecipeManager}
        onClose={() => setShowRecipeManager(false)}
        onRecipesChanged={refreshRecipes}
      />
    </div>
  );
}