'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  Truck,
  UtensilsCrossed,
  CreditCard,
  Users,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  ArrowRight,
  Flame,
  Soup,
  Wheat,
  MapPin,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

import { computePrepMetrics } from '@/app/prep/prepCalculations';
import {
  calculateCycleTargetLastDay,
  resolveDeliveryDayNumbers,
  getNextServiceDate,
} from '@/app/utils/subscriptionCycle';
import { isPickupOnDay } from '@/app/utils/customerPickup';
import {
  PORTION_LG,
  PORTION_RG,
  PORTION_HALF_LG,
  PORTION_HALF_RG,
  normalizePortionToken,
  formatStreetOnlyAddress,
  cleanPhoneNumberForWhatsApp,
} from '@/app/utils/mealEngine';
import { MessageSquare } from 'lucide-react';

type Customer = {
  id: string;
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  delivery_schedule: string | null;
  plan_tier: string | null;
  total_tiffin_credits: number | null;
  used_credits: number | null;
  subscription_status: string | null;
  payment_status?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  custom_plan_price?: number | null;
  start_date: string | null;
  cycle_end_date: string | null;
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  pronthi_count: number | null;
  rice_count: string | null;
  delivery_instructions: string | null;
  dietary_notes: string | null;
  is_custom_curry: boolean | null;
  curry_config: string | null;
  weekly_schedule_matrix: string | null;
  disliked_dishes: string[] | null;
  scheduled_cancel_date: string | null;
  scheduled_status: string | null;
};

type DeliveryLog = {
  customer_id: string;
  status: string;
  delivery_date: string;
};

type Closure = {
  id: string;
  closure_date: string;
  reason: string;
};

type Override = {
  customer_id: string;
  override_date: string;
  is_skipped: boolean | null;
};

type DailyMenu = {
  date: string;
  veg_option_1: string | null;
  veg_option_2: string | null;
  chicken_option: string | null;
};

type Recipe = {
  id: string;
  name: string;
  category: 'dal' | 'sabji';
};

interface Props {
  todayKey: string;
  initialCustomers: Customer[];
  todayDeliveries: DeliveryLog[];
  closures: Closure[];
  upcomingOverrides: Override[];
  todayMenu: DailyMenu | null;
  availableRecipes: Recipe[];
  settings: Record<string, any> | null;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DashboardClient({
  todayKey,
  initialCustomers,
  todayDeliveries,
  closures,
  upcomingOverrides,
  todayMenu,
  availableRecipes,
  settings,
}: Props) {
  const todayDate = useMemo(() => new Date(`${todayKey}T12:00:00`), [todayKey]);
  const activeDay = useMemo(() => DAYS_OF_WEEK[todayDate.getDay()], [todayDate]);
  const isChickenDay = activeDay === 'Monday' || activeDay === 'Wednesday' || activeDay === 'Friday';

  // 1. Closures & Skips sets
  const closuresSet = useMemo(() => new Set(closures.map(c => c.closure_date)), [closures]);
  const skipsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    upcomingOverrides.forEach(o => {
      if (o.is_skipped) {
        if (!map.has(o.customer_id)) map.set(o.customer_id, new Set());
        map.get(o.customer_id)!.add(o.override_date);
      }
    });
    return map;
  }, [upcomingOverrides]);

  const deliveredIds = useMemo(
    () => new Set(todayDeliveries.map(d => d.customer_id)),
    [todayDeliveries]
  );

  // 2. Identify customers scheduled for today
  const scheduledToday = useMemo(() => {
    if (closuresSet.has(todayKey)) return [];

    return initialCustomers.filter(c => {
      const subStatus = (c.subscription_status || 'active').toLowerCase();
      if (subStatus === 'cancelled' || subStatus === 'paused') return false;

      const sched = (c.delivery_schedule || '').toLowerCase();
      const shortDay = activeDay.slice(0, 3).toLowerCase();
      const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(activeDay);

      const dayMatches =
        (sched.includes('monday to friday') && isWeekday) ||
        sched.includes(activeDay.toLowerCase()) ||
        sched.includes(shortDay);

      if (!dayMatches) return false;

      const custSkips = skipsMap.get(c.id);
      if (custSkips && custSkips.has(todayKey)) return false;

      return true;
    });
  }, [initialCustomers, activeDay, todayKey, closuresSet, skipsMap]);

  // Split deliveries vs pickups
  const deliveriesToday = useMemo(
    () => scheduledToday.filter(c => !isPickupOnDay(c, activeDay)),
    [scheduledToday, activeDay]
  );
  const pickupsToday = useMemo(
    () => scheduledToday.filter(c => isPickupOnDay(c, activeDay)),
    [scheduledToday, activeDay]
  );

  const completedCount = deliveriesToday.filter(c => deliveredIds.has(c.id)).length;
  const deliveryProgressPct =
    deliveriesToday.length > 0
      ? Math.round((completedCount / deliveriesToday.length) * 100)
      : 0;

  // 3. Compute kitchen prep requirements for today
  const prepMetrics = useMemo(() => {
    return computePrepMetrics(
      scheduledToday,
      isChickenDay,
      {
        dalName: todayMenu?.veg_option_1 || 'Dal',
        sabjiName: todayMenu?.veg_option_2 || 'Sabji',
      },
      activeDay
    );
  }, [scheduledToday, isChickenDay, todayMenu, activeDay]);

  // 4. Action items: Renewals Due & Expiring Cycles
  const expiringCustomers = useMemo(() => {
    return initialCustomers
      .filter(c => (c.subscription_status || 'active').toLowerCase() === 'active')
      .map(c => {
        const tier = (c.plan_tier || 'monthly').toLowerCase();
        const total = tier === 'monthly' ? 20 : tier === 'weekly' ? 5 : 1;
        const used = c.used_credits || 0;
        const remaining = Math.max(0, total - used);

        const isLastDay =
          c.cycle_end_date?.slice(0, 10) === todayKey || remaining <= 0;

        const nextService = getNextServiceDate({
          fromDateStr: todayKey,
          deliverySchedule: c.delivery_schedule,
          closureDates: closuresSet,
          customerSkips: skipsMap.get(c.id),
        });

        return {
          customer: c,
          remaining,
          total,
          isLastDay,
          nextServiceFormatted: nextService ? nextService.formatted : 'next scheduled day',
        };
      })
      .filter(item => item.isLastDay || item.remaining <= 2)
      .slice(0, 5);
  }, [initialCustomers, todayKey, closuresSet, skipsMap]);

  // 4b. Pending and Overdue Payments List
  const unpaidCustomers = useMemo(() => {
    return initialCustomers
      .filter(c => {
        const sub = (c.subscription_status || 'active').toLowerCase();
        if (sub !== 'active') return false;

        const pay = (c.payment_status || 'due').toLowerCase();
        return pay === 'due' || pay === 'overdue';
      })
      .map(c => {
        const tier = (c.plan_tier || 'monthly').toLowerCase();
        const baseRate = tier === 'trial' ? 14 : tier === 'weekly' ? 65 : 250;
        const discountVal = c.discount_value || 0;

        let expected = baseRate;
        if (c.custom_plan_price != null && Number(c.custom_plan_price) > 0) {
          expected = Number(c.custom_plan_price);
        } else if (c.discount_type === 'flat') {
          expected = Math.max(0, baseRate - discountVal);
        } else if (c.discount_type === 'percent') {
          expected = Math.max(0, Math.round(baseRate * (1 - discountVal / 100)));
        }

        const cleanPhone = cleanPhoneNumberForWhatsApp(c.phone_number);
        const reminderText = `Hi ${c.full_name}, this is a gentle reminder regarding your tiffin subscription payment of $${expected} CAD. Please send the e-transfer at your convenience. Thank you!`;

        const isOverdue =
          (c.used_credits || 0) > (c.total_tiffin_credits || (tier === 'monthly' ? 20 : 5));

        return {
          customer: c,
          expectedAmount: expected,
          cleanPhone,
          reminderText,
          isOverdue,
        };
      });
  }, [initialCustomers]);

  // 5. Next upcoming kitchen closures (within 14 days)
  const upcomingClosures = useMemo(() => {
    return closures
      .filter(c => c.closure_date >= todayKey)
      .slice(0, 3);
  }, [closures, todayKey]);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0 font-sans select-none text-[#292D32]">
      {/* ── UNIFIED PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200/80 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#5D5FEF] text-white flex items-center justify-center shadow-2xs font-black text-sm">
              ⚡
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
              Command Dashboard
            </h1>
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-full">
              Live Operations
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
            Real-time status for <strong className="text-gray-800">{activeDay}, {todayKey}</strong> · Kitchen, logistics &amp; subscription health
          </p>
        </div>

        {/* Quick Route Shortcuts */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            href="/prep"
            className="h-9 px-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5"
          >
            <UtensilsCrossed className="w-3.5 h-3.5 text-gray-500" />
            <span>Kitchen Prep</span>
          </Link>
          <Link
            href="/admin/deliveries"
            className="h-9 px-3.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Dispatch Route</span>
          </Link>
        </div>
      </div>

      {/* ── TOP KPI PULSE ROW (4 CARDS) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {/* Card 1: Delivery Route Pulse */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-gray-400 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Today&apos;s Deliveries
              </span>
              <Truck className="w-4 h-4 text-[#5D5FEF]" />
            </div>
            <div className="text-2xl font-black text-gray-900 tracking-tight">
              {completedCount} <span className="text-gray-400 text-base font-bold">/ {deliveriesToday.length}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden mt-3 mb-2">
              <div
                className="h-full bg-[#5D5FEF] rounded-full transition-all duration-300"
                style={{ width: `${deliveryProgressPct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500 pt-1">
            <span>{deliveriesToday.length - completedCount} stops remaining</span>
            {pickupsToday.length > 0 && (
              <span className="text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded font-bold">
                {pickupsToday.length} Pickup
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Kitchen Cooking Target */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-gray-400 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Kitchen Prep Target
              </span>
              <UtensilsCrossed className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-gray-900 tracking-tight">
              {prepMetrics.totalMeals} <span className="text-gray-400 text-base font-bold">Orders</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                {scheduledToday.filter(c => !(c.meal_type || '').toLowerCase().includes('non')).length} Veg
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-black bg-rose-50 text-rose-700 border border-rose-200">
                {scheduledToday.filter(c => (c.meal_type || '').toLowerCase().includes('non')).length} Non-Veg
              </span>
            </div>
          </div>
          <div className="text-[11px] font-bold text-gray-600 pt-2 border-t border-gray-100 mt-2">
            🍞 {prepMetrics.totalRoti} Roti · 🍚 {prepMetrics.totalRiceContainers} Rice
          </div>
        </div>

        {/* Card 3: Financial Collection Pulse */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-gray-400 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Payment Collections
              </span>
              <CreditCard className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-gray-900 tracking-tight">
              {initialCustomers.filter(c => (c.subscription_status || 'active').toLowerCase() === 'active').length - unpaidCustomers.length}
              <span className="text-gray-400 text-base font-bold"> / {initialCustomers.filter(c => (c.subscription_status || 'active').toLowerCase() === 'active').length} Paid</span>
            </div>
            <p className="text-[11.5px] font-semibold text-amber-700 mt-1">
              {unpaidCustomers.length > 0 ? `${unpaidCustomers.length} customer(s) have payments pending` : 'All active subscriptions up to date'}
            </p>
          </div>
          <Link
            href="/admin/billing"
            className="text-[11px] font-bold text-[#5D5FEF] hover:underline pt-2 flex items-center justify-between border-t border-gray-100 mt-2"
          >
            <span>Open billing ledger</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Card 4: Total Customer Base */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-gray-400 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Subscriber Base
              </span>
              <Users className="w-4 h-4 text-gray-500" />
            </div>
            <div className="text-2xl font-black text-gray-900 tracking-tight">
              {initialCustomers.filter(c => (c.subscription_status || 'active').toLowerCase() === 'active').length}
              <span className="text-gray-400 text-base font-bold"> Active</span>
            </div>
            <p className="text-[11.5px] font-semibold text-gray-500 mt-1">
              <strong className="text-emerald-700">{initialCustomers.filter(c => (c.subscription_status || 'active').toLowerCase() === 'active').length - unpaidCustomers.length} Paid</strong>
              {' · '}
              <strong className={unpaidCustomers.length > 0 ? 'text-amber-700' : 'text-gray-400'}>
                {unpaidCustomers.length} Due
              </strong>
            </p>
          </div>
          <Link
            href="/admin/customers"
            className="text-[11px] font-bold text-[#5D5FEF] hover:underline pt-2 flex items-center justify-between border-t border-gray-100 mt-2"
          >
            <span>Manage customer directory</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* ── TWO-COLUMN WORKSPACE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* LEFT COLUMN: Operations & Today's Menu (7 of 12 cols) */}
        <div className="lg:col-span-7 space-y-6 flex flex-col min-h-0">
          {/* Section A: Today's Kitchen Menu Status */}
          <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Soup className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Today&apos;s Menu Stations
                </h3>
              </div>
              <Link
                href="/admin/recipes"
                className="text-xs font-bold text-[#5D5FEF] hover:underline"
              >
                Recipe Catalog →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
              <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200/70">
                <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider block mb-1">
                  Dal Option
                </span>
                <span className="text-sm font-black text-amber-950 block truncate">
                  {todayMenu?.veg_option_1 || 'Unassigned'}
                </span>
                <span className="text-[11px] font-semibold text-amber-800 mt-1 block">
                  {prepMetrics.dalOz} oz target ({prepMetrics.dalPackRG} RG · {prepMetrics.dalPackLG} LG)
                </span>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/70">
                <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block mb-1">
                  Sabji Option
                </span>
                <span className="text-sm font-black text-emerald-950 block truncate">
                  {todayMenu?.veg_option_2 || 'Unassigned'}
                </span>
                <span className="text-[11px] font-semibold text-emerald-800 mt-1 block">
                  {prepMetrics.sabjiOz} oz target ({prepMetrics.sabjiPackRG} RG · {prepMetrics.sabjiPackLG} LG)
                </span>
              </div>

              <div className="p-3 rounded-xl bg-rose-50/50 border border-rose-200/70">
                <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider block mb-1">
                  Non-Veg Station
                </span>
                <span className="text-sm font-black text-rose-950 block truncate">
                  {isChickenDay ? todayMenu?.chicken_option || 'Chicken Curry' : 'Veg Day (Idle)'}
                </span>
                <span className="text-[11px] font-semibold text-rose-800 mt-1 block">
                  {isChickenDay ? `${prepMetrics.chickenOz} oz (${prepMetrics.chickenLegs} legs)` : 'No chicken today'}
                </span>
              </div>
            </div>
          </div>

          {/* Section B: Live Delivery Dispatch Queue */}
          <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-5 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#5D5FEF]" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Live Dispatch Stops ({deliveriesToday.length - completedCount} Left)
                </h3>
              </div>
              <Link
                href="/admin/deliveries"
                className="text-xs font-bold text-[#5D5FEF] hover:underline"
              >
                Full Route System →
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 pt-1">
              {deliveriesToday.filter(c => !deliveredIds.has(c.id)).length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-gray-700">All deliveries logged for today!</p>
                </div>
              ) : (
                deliveriesToday
                  .filter(c => !deliveredIds.has(c.id))
                  .slice(0, 6)
                  .map((customer, index) => (
                    <div key={customer.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[10.5px] font-black flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-gray-900 truncate block">
                            {customer.full_name}
                          </span>
                          <span className="text-[11px] text-gray-500 truncate block">
                            {formatStreetOnlyAddress(customer.delivery_address)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono font-bold text-gray-700">
                          {customer.roti_count ?? 8} Roti
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          (customer.meal_type || '').toLowerCase().includes('non')
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {normalizePortionToken(customer.portion_size)}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Action Items, Expiring Subscriptions & Closures (5 of 12 cols) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col min-h-0">
          {/* Unified Action Card: Subscriptions Requiring Action & Payments */}
          <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Action Required: Renewals &amp; Payments
                </h3>
              </div>
              <span className="text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                {expiringCustomers.length} Due
              </span>
            </div>

            <div className="divide-y divide-gray-100 pt-1">
              {expiringCustomers.length === 0 ? (
                <div className="py-6 text-center text-xs font-semibold text-gray-400">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1 opacity-80" />
                  No subscriptions expiring or payments due today.
                </div>
              ) : (
                expiringCustomers.map(({ customer, remaining, isLastDay, nextServiceFormatted }) => {
                  const unpaidInfo = unpaidCustomers.find(u => u.customer.id === customer.id);

                  return (
                    <div key={customer.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-gray-900 truncate">
                            {customer.full_name}
                          </span>

                          {isLastDay ? (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-black bg-rose-100 text-rose-800 uppercase">
                              Final Meal Today
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-black bg-amber-100 text-amber-800 uppercase">
                              {remaining} meals left
                            </span>
                          )}

                          {unpaidInfo && (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-black bg-amber-50 text-amber-700 border border-amber-200 uppercase">
                              ${unpaidInfo.expectedAmount} Due
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] text-gray-500 mt-0.5 block truncate">
                          Next cycle starts {nextServiceFormatted}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {unpaidInfo?.cleanPhone && (
                          <a
                            href={`https://wa.me/${unpaidInfo.cleanPhone}?text=${encodeURIComponent(unpaidInfo.reminderText)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Send WhatsApp payment reminder"
                            className="h-7 px-2 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span className="hidden sm:inline">Remind</span>
                          </a>
                        )}

                        <Link
                          href="/admin/customers"
                          className="h-7 px-2.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white rounded-xl text-[11px] font-bold flex items-center shadow-2xs transition-all"
                        >
                          Renew
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Upcoming Kitchen Closures */}
          <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Upcoming Holidays &amp; Closures
                </h3>
              </div>
              <Link
                href="/admin/closures"
                className="text-xs font-bold text-[#5D5FEF] hover:underline"
              >
                Holidays →
              </Link>
            </div>

            <div className="divide-y divide-gray-100 pt-1">
              {upcomingClosures.length === 0 ? (
                <div className="py-6 text-center text-xs font-semibold text-gray-400">
                  No upcoming kitchen holidays scheduled.
                </div>
              ) : (
                upcomingClosures.map(closure => (
                  <div key={closure.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-gray-900 block">
                        {closure.reason || 'Kitchen Closed'}
                      </span>
                      <span className="text-[11px] font-medium text-gray-500 block">
                        {closure.closure_date}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                      Auto-compensated
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}