// Shared, holiday-aware subscription-cycle date math.
//
// SINGLE SOURCE OF TRUTH for "when does this billing cycle end?" — imported by:
//   • /admin/customers            (projected end date + holiday/skip breakdown)
//   • /prep                       (renewal action + optimistic manifest update)
//   • /admin/closures             (credit grants / reversals that re-walk the cycle)
//
// Model:
//   • A "delivery day" is a weekday the customer is actually scheduled on (parsed
//     from `delivery_schedule`). When the schedule is empty/unknown we fall back to
//     the canonical Mon–Fri plan.
//   • Kitchen closures (`kitchen_closures`) and customer skips
//     (`customer_daily_overrides.is_skipped`) are COMPENSATED days: they do not
//     consume a meal credit, but they push the cycle end one delivery day further
//     out (so a 20-meal plan still serves 20 meals).
//   • The start day counts as the first delivery when it is itself a delivery day.

import { FULL_DAY_NAMES, parseActiveScheduleDays } from './customerPickup';

// JS Date#getDay() numbers for the canonical Mon–Fri default plan (0 = Sunday).
export const DEFAULT_DELIVERY_DAY_NUMBERS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

// Local calendar key (avoids the UTC shift toISOString() would introduce).
export const toLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatShortDate = (dateKey: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Accepts 'YYYY-MM-DD', 'MM/DD/YYYY' (the admin form's typed format) or a full
// timestamp and returns a normalized 'YYYY-MM-DD' key (null when unusable).
export const normalizeDateKey = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const key = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
};

// Maps a stored `delivery_schedule` to JS getDay() numbers.
// Empty/unknown schedules fall back to Mon–Fri so date math never silently stalls.
export const resolveDeliveryDayNumbers = (
  schedule: string | null | undefined
): Set<number> => {
  const days = parseActiveScheduleDays(schedule);
  if (days.length === 0) return new Set(DEFAULT_DELIVERY_DAY_NUMBERS);

  const numbers = new Set<number>();
  days.forEach(day => {
    const index = FULL_DAY_NAMES.indexOf(day);
    if (index === -1) return;
    // FULL_DAY_NAMES starts at Monday; getDay() starts at Sunday.
    numbers.add((index + 1) % 7);
  });
  return numbers.size > 0 ? numbers : new Set(DEFAULT_DELIVERY_DAY_NUMBERS);
};

export type ClosureSource =
  | Set<string>
  | Map<string, string>
  | string[]
  | null
  | undefined;

const isClosedOn = (date: Date, closureDates: ClosureSource): boolean => {
  if (!closureDates) return false;
  const key = toLocalDateKey(date);
  if (closureDates instanceof Set) return closureDates.has(key);
  if (closureDates instanceof Map) return closureDates.has(key);
  return closureDates.includes(key);
};

const isCustomerSkipOn = (date: Date, customerSkips?: Set<string> | null): boolean =>
  Boolean(customerSkips?.has(toLocalDateKey(date)));

export type CycleTargetInput = {
  startDate: string | null | undefined;
  totalMeals: number | null | undefined;
  deliveryDays?: Set<number> | number[] | null;
  closureDates?: ClosureSource;
  customerSkips?: Set<string> | null;
};

export type CycleTargetResult = {
  dateKey: string;
  holidayDaysSkipped: number;
  customerDaysSkipped: number;
};

// Walks forward from `startDate` counting DELIVERY days until `totalMeals`
// meals are served, compensating kitchen closures and customer skips.
// Returns null when the inputs are unusable (bad date, no meals, runaway guard).
export const calculateCycleTargetLastDay = (
  input: CycleTargetInput
): CycleTargetResult | null => {
  const { startDate, totalMeals, closureDates, customerSkips } = input;
  const meals = Number(totalMeals);
  if (!startDate || !Number.isFinite(meals) || meals <= 0) return null;

  const normalized = normalizeDateKey(startDate);
  if (!normalized) return null;

  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const rawDays = input.deliveryDays;
  const deliveryDays: Set<number> =
    rawDays instanceof Set && rawDays.size > 0
      ? rawDays
      : Array.isArray(rawDays) && rawDays.length > 0
        ? new Set(rawDays)
        : new Set(DEFAULT_DELIVERY_DAY_NUMBERS);

  const isDeliveryDay = (d: Date): boolean => deliveryDays.has(d.getDay());

  let mealsCounted = 0;
  let holidayDaysSkipped = 0;
  let customerDaysSkipped = 0;

  if (isDeliveryDay(date)) {
    if (isClosedOn(date, closureDates)) holidayDaysSkipped++;
    else if (isCustomerSkipOn(date, customerSkips)) customerDaysSkipped++;
    else mealsCounted = 1;
  }

  while (mealsCounted < meals) {
    date.setDate(date.getDate() + 1);
    if (isDeliveryDay(date)) {
      if (isClosedOn(date, closureDates)) holidayDaysSkipped++;
      else if (isCustomerSkipOn(date, customerSkips)) customerDaysSkipped++;
      else mealsCounted++;
    }
    if (mealsCounted > 730) return null;
  }

  return {
    dateKey: toLocalDateKey(date),
    holidayDaysSkipped,
    customerDaysSkipped,
  };
};

// Convenience wrapper returning just the 'YYYY-MM-DD' end key.
export const computeCycleEndDate = (input: CycleTargetInput): string | null =>
  calculateCycleTargetLastDay(input)?.dateKey ?? null;

// Shifts a cycle end by `delta` DELIVERY days (positive = extend, negative = roll
// back). Kitchen closures are skipped so a closure never swallows a purchased
// credit. Returns null when the anchor date is unusable.
export const shiftCycleEndByDeliveryDays = (
  endDateKey: string | null | undefined,
  delta: number,
  deliveryDays?: Set<number> | null,
  closureDates?: ClosureSource
): string | null => {
  const normalized = normalizeDateKey(endDateKey);
  if (!normalized) return null;
  if (!Number.isFinite(delta) || delta === 0) return normalized;

  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const days =
    deliveryDays && deliveryDays.size > 0
      ? deliveryDays
      : new Set(DEFAULT_DELIVERY_DAY_NUMBERS);

  const step = delta > 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(delta));
  let guard = 0;

  while (remaining > 0 && guard < 2000) {
    date.setDate(date.getDate() + step);
    guard++;
    if (!days.has(date.getDay())) continue;
    if (isClosedOn(date, closureDates)) continue;
    remaining--;
  }

  return toLocalDateKey(date);
};

// Plan tier implied by a credit amount — keeps `plan_tier`, `total_tiffin_credits`
// and the "20 Meals / 5 Meals / 1 Meal" label in sync after a renewal.
export const resolvePlanTierForCredits = (
  credits: number
): 'trial' | 'weekly' | 'monthly' => {
  if (credits >= 20) return 'monthly';
  if (credits > 1) return 'weekly';
  return 'trial';
};

// ============================================================================
// STANDARD SUBSCRIPTION PRICING ENGINE
// ============================================================================

export type PricingTier = 'trial' | 'weekly' | 'monthly';

export type PlanTierPricing = {
  veg_rg: number;
  veg_lg: number;
  nv_rg: number;
  nv_lg: number;
};
export type TierPrices = PlanTierPricing;

export type PlanPricingMatrix = {
  monthly: PlanTierPricing;
  weekly: PlanTierPricing;
  trial: PlanTierPricing;
};

export const DEFAULT_PRICING_MATRIX: PlanPricingMatrix = {
  monthly: { veg_rg: 220, veg_lg: 250, nv_rg: 250, nv_lg: 280 },
  weekly:  { veg_rg: 60,  veg_lg: 70,  nv_rg: 70,  nv_lg: 80 },
  trial:   { veg_rg: 13,  veg_lg: 15,  nv_rg: 15,  nv_lg: 17 },
};

export function calculateStandardPlanPrice(
  mealTypeOrCustomer: string | null | undefined | {
    meal_type?: string | null;
    portion_size?: string | null;
    plan_tier?: string | null;
    custom_plan_price?: number | null;
    delivery_fee_per_day?: number | null;
    addon_fee_per_day?: number | null;
  },
  portionSize?: string | null | undefined,
  planTier: PricingTier = 'monthly',
  credits: number = 20,
  pricingMatrix?: PlanPricingMatrix | null,
  deliveryFeePerDay: number = 0,
  addonFeePerDay: number = 0
): number {
  if (typeof mealTypeOrCustomer === 'object' && mealTypeOrCustomer !== null) {
    if (mealTypeOrCustomer.custom_plan_price != null && Number(mealTypeOrCustomer.custom_plan_price) > 0) {
      return Number(mealTypeOrCustomer.custom_plan_price);
    }
    return calculateStandardPlanPrice(
      mealTypeOrCustomer.meal_type,
      mealTypeOrCustomer.portion_size,
      (mealTypeOrCustomer.plan_tier as PricingTier) || 'monthly',
      credits,
      pricingMatrix,
      Number(mealTypeOrCustomer.delivery_fee_per_day || 0),
      Number(mealTypeOrCustomer.addon_fee_per_day || 0)
    );
  }

  const mealType = mealTypeOrCustomer;
  const isNonVeg = (mealType || '').toLowerCase().includes('non');
  const size = (portionSize || 'RG').trim().toUpperCase();
  const isLarge = size.includes('LG') || size.includes('LARGE');

  const matrix = pricingMatrix || DEFAULT_PRICING_MATRIX;
  const tierConfig = matrix[planTier] || matrix.monthly;

  let basePrice: number;
  if (isNonVeg) {
    basePrice = isLarge ? tierConfig.nv_lg : tierConfig.nv_rg;
  } else {
    basePrice = isLarge ? tierConfig.veg_lg : tierConfig.veg_rg;
  }

  // Scale base price if custom meal credits differ from standard tier count
  const standardTierCredits = planTier === 'weekly' ? 5 : planTier === 'trial' ? 1 : 20;
  if (credits !== standardTierCredits && standardTierCredits > 0) {
    basePrice = Math.round((basePrice / standardTierCredits) * credits);
  }

  // Multiply per-day recurring surcharges by total credits in this cycle
  const extraDailyTotal = (Number(deliveryFeePerDay || 0) + Number(addonFeePerDay || 0)) * credits;

  return Math.round(basePrice + extraDailyTotal);
}
// ============================================================================
// BILLING PERIOD TRACKER & LEDGER RESOLVER
// ============================================================================

export type BillingPeriodInfo = {
  index: number; // 0 = current, -1 = past 1, -2 = past 2, -3 = past 3
  label: string;
  startDate: string;
  endDate: string;
  credits: number;
  expectedAmount: number;
  paymentId?: string | null;
  isPaid: boolean;
  paymentMethod?: string | null;
  paidAt?: string | null;
};

export function computeCustomerPeriods(params: {
  customer: {
    id: string;
    start_date?: string | null;
    plan_tier?: string | null;
    total_tiffin_credits?: number | null;
    meal_type?: string | null;
    portion_size?: string | null;
    custom_plan_price?: number | null; // <--- allow manual override
    delivery_fee_per_day?: number | null;
    addon_fee_per_day?: number | null;
    discount_type?: 'flat' | 'percent' | null;
    discount_value?: number | null;
    delivery_schedule?: string | null;
  };
  payments: Array<{
    id: string;
    amount: number;
    payment_method?: string | null;
    paid_at?: string | null;
    billing_cycle_start?: string | null;
    billing_cycle_end?: string | null;
  }>;
  closureDates?: ClosureSource;
  customerSkips?: Set<string> | null;
  pricingMatrix?: PlanPricingMatrix | null;
}): BillingPeriodInfo[] {
  const { customer, payments, closureDates, customerSkips, pricingMatrix } = params;
  if (!customer.start_date) return [];

  const tier = (customer.plan_tier || 'monthly').toLowerCase() as PricingTier;
  
  const creditsPerCycle =
    tier === 'weekly'
      ? 5
      : tier === 'trial'
      ? 1
      : 20;

  let finalPrice: number;

  // If customer has an explicit manual charge, use it directly
  if (customer.custom_plan_price != null && Number(customer.custom_plan_price) > 0) {
    finalPrice = Number(customer.custom_plan_price);
  } else {
    const basePrice = calculateStandardPlanPrice(
      customer.meal_type,
      customer.portion_size,
      tier,
      creditsPerCycle,
      pricingMatrix,
      Number(customer.delivery_fee_per_day || 0),
      Number(customer.addon_fee_per_day || 0)
    );

    let discount = 0;
    if (customer.discount_type === 'flat') {
      discount = Number(customer.discount_value) || 0;
    } else if (customer.discount_type === 'percent') {
      discount = Math.round((basePrice * (Number(customer.discount_value) || 0)) / 100);
    }
    finalPrice = Math.max(0, basePrice - discount);
  }

  const deliveryDays = resolveDeliveryDayNumbers(customer.delivery_schedule);
  const curStart = customer.start_date.slice(0, 10);

  const currentEndResult = calculateCycleTargetLastDay({
    startDate: curStart,
    totalMeals: creditsPerCycle,
    deliveryDays,
    closureDates,
    customerSkips,
  });

  const currentEnd = currentEndResult?.dateKey || curStart;

  const periodsData: Array<{ index: number; label: string; start: string; end: string }> = [
    { index: 0, label: 'Current Cycle', start: curStart, end: currentEnd }
  ];

  const stepDate = (dStr: string, days: number): string => {
    const d = new Date(`${dStr}T12:00:00`);
    d.setDate(d.getDate() + days);
    return toLocalDateKey(d);
  };

  let prevEnd = stepDate(curStart, -1);
  const daysSet = deliveryDays instanceof Set ? deliveryDays : new Set(DEFAULT_DELIVERY_DAY_NUMBERS);
  const customerJoinDate = curStart; // Customer's registration start date

  for (let i = 1; i <= 3; i++) {
    let count = 0;
    const cursor = new Date(`${prevEnd}T12:00:00`);
    let periodStart = prevEnd;

    while (count < creditsPerCycle) {
      const dayNum = cursor.getDay();
      const isClosure = isClosedOn(cursor, closureDates);
      const isSkip = isCustomerSkipOn(cursor, customerSkips);

      if (daysSet.has(dayNum) && !isClosure && !isSkip) {
        count++;
        periodStart = toLocalDateKey(cursor);
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    // STOP generating older historical cycles if the period started before the customer joined,
    // UNLESS there is already an explicit payment recorded in the ledger for this timeframe.
    if (periodStart < customerJoinDate) {
      const hasRecordedPayment = payments.some(pmt => {
        if (!pmt.billing_cycle_start) return false;
        const pmtStart = pmt.billing_cycle_start.slice(0, 10);
        return pmtStart >= periodStart && pmtStart <= prevEnd;
      });

      if (!hasRecordedPayment) {
        break; // Stop loop so older unassociated periods are not shown
      }
    }

    periodsData.push({
      index: -i,
      label: i === 1 ? 'Previous Cycle' : `${i} Cycles Ago`,
      start: periodStart,
      end: prevEnd,
    });

    prevEnd = stepDate(periodStart, -1);
  }

  periodsData.sort((a, b) => b.start.localeCompare(a.start));

  return periodsData.map(p => {
    const match = payments.find(pmt => {
      if (!pmt.billing_cycle_start) return false;
      const pmtStart = pmt.billing_cycle_start.slice(0, 10);
      const pmtEnd = pmt.billing_cycle_end ? pmt.billing_cycle_end.slice(0, 10) : null;
      return pmtStart === p.start || (pmtEnd && pmtEnd === p.end);
    });

    return {
      index: p.index,
      label: p.label,
      startDate: p.start,
      endDate: p.end,
      credits: creditsPerCycle,
      expectedAmount: finalPrice,
      paymentId: match?.id || null,
      isPaid: Boolean(match),
      paymentMethod: match?.payment_method || null,
      paidAt: match?.paid_at || null,
    };
  });
}
/**
 * Resolves the next delivery day for a customer after today,
 * skipping weekends, off-schedule days, kitchen closures, and customer skips.
 */
export function getNextServiceDate({
  fromDateStr,
  deliverySchedule,
  closureDates,
  customerSkips,
}: {
  fromDateStr: string; // YYYY-MM-DD
  deliverySchedule?: string | null;
  closureDates?: Set<string>;
  customerSkips?: Set<string>;
}): { dateKey: string; formatted: string } | null {
  const deliveryDays = resolveDeliveryDayNumbers(deliverySchedule);
  const start = new Date(`${fromDateStr}T12:00:00`);
  if (isNaN(start.getTime())) return null;

  // Search forward up to 30 days
  const cursor = new Date(start);
  for (let i = 1; i <= 30; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const dayOfWeek = cursor.getDay();
    const dateKey = cursor.toISOString().slice(0, 10);

    // 1. Is it on the customer's delivery schedule?
    if (deliveryDays.size > 0 && !deliveryDays.has(dayOfWeek)) continue;

    // 2. Is kitchen closed on this day?
    if (closureDates && closureDates.has(dateKey)) continue;

    // 3. Has the customer logged a skip for this day?
    if (customerSkips && customerSkips.has(dateKey)) continue;

    // Calculate readable label
    const diffDays = Math.round((cursor.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let formatted = '';
    if (diffDays === 1) {
      formatted = `tomorrow (${dayName})`;
    } else if (diffDays <= 7) {
      formatted = `this ${dayName} (${monthDay})`;
    } else {
      formatted = `${dayName}, ${monthDay}`;
    }

    return { dateKey, formatted };
  }

  return null;
}

// ============================================================================
// SINGLE SOURCE OF TRUTH: LIVE CYCLE METRICS & ELAPSED DAYS
// ============================================================================

/**
 * Counts the actual elapsed delivery days between `startDate` and `asOfDateKey`
 * (excluding non-schedule weekdays, kitchen closures, and customer skips).
 * Capped at `totalMeals` so delivered count never exceeds the plan credits.
 */
export function calculateElapsedDeliveryDays(
  startDateStr: string | null | undefined,
  closureDates?: ClosureSource,
  totalMeals: number = 20,
  customerSkips?: Set<string> | null,
  deliveryDays?: Set<number> | null,
  asOfDateKey: string = toLocalDateKey(new Date())
): number {
  const normalizedStart = normalizeDateKey(startDateStr);
  if (!normalizedStart) return 0;
  if (normalizedStart > asOfDateKey) return 0;

  const days =
    deliveryDays && deliveryDays.size > 0
      ? deliveryDays
      : new Set(DEFAULT_DELIVERY_DAY_NUMBERS);

  const cursor = new Date(`${normalizedStart}T00:00:00`);
  const target = new Date(`${asOfDateKey}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(target.getTime())) return 0;

  let delivered = 0;
  let guard = 0;

  while (cursor <= target && guard < 1000) {
    guard++;
    const dayNum = cursor.getDay();

    if (days.has(dayNum)) {
      const isClosed = isClosedOn(cursor, closureDates);
      const isSkip = isCustomerSkipOn(cursor, customerSkips);

      if (!isClosed && !isSkip) {
        delivered++;
        if (delivered >= totalMeals) {
          return totalMeals;
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return delivered;
}

export type CustomerLiveMetrics = {
  totalMeals: number;
  deliveredMeals: number;
  remainingMeals: number;
  graceMeals: number;
  effectiveEndDate: string | null;
  status: 'active' | 'due' | 'overdue' | 'paid' | 'lapsed';
  isLastDay: boolean;
};

/**
 * MASTER SINGLE SOURCE OF TRUTH FOR ALL CUSTOMER CYCLE METRICS.
 * Call this function anywhere in the app to get guaranteed-consistent numbers.
 */
export function getCustomerLiveMetrics({
  customer,
  closuresSet,
  skipsSet,
  isPaid = false,
  todayDateKey = toLocalDateKey(new Date()),
}: {
  customer: {
    id: string;
    start_date?: string | null;
    cycle_end_date?: string | null;
    plan_tier?: string | null;
    total_tiffin_credits?: number | null;
    total_credits?: number | null;
    delivery_schedule?: string | null;
    subscription_status?: string | null;
    used_credits?: number | null;
  };
  closuresSet?: ClosureSource;
  skipsSet?: Set<string> | null;
  isPaid?: boolean;
  todayDateKey?: string;
}): CustomerLiveMetrics {
  const tier = (customer.plan_tier || '').toLowerCase();

  // 1. Resolve Total Credits (fallback to canonical plan defaults)
  let totalMeals = customer.total_tiffin_credits ?? customer.total_credits;
  if (typeof totalMeals !== 'number' || totalMeals <= 0) {
    if (tier === 'trial') totalMeals = 1;
    else if (tier === 'weekly') totalMeals = 5;
    else totalMeals = 20;
  }

  // 2. Resolve Schedule & Elapsed Delivery Days
  const deliveryDays = resolveDeliveryDayNumbers(customer.delivery_schedule);
  const deliveredMeals = customer.start_date
    ? calculateElapsedDeliveryDays(
        customer.start_date,
        closuresSet,
        totalMeals,
        skipsSet,
        deliveryDays,
        todayDateKey
      )
    : 0;

  // 3. Compute Remaining & Grace
  const remainingMeals = Math.max(0, totalMeals - deliveredMeals);
  const graceMeals = Math.max(0, deliveredMeals - totalMeals);

  // 4. Calculate Holiday- and Skip-Compensated End Date
  const targetEndResult = customer.start_date
    ? calculateCycleTargetLastDay({
        startDate: customer.start_date,
        totalMeals,
        deliveryDays,
        closureDates: closuresSet,
        customerSkips: skipsSet,
      })
    : null;

  const effectiveEndDate =
    targetEndResult?.dateKey ||
    (customer.cycle_end_date ? customer.cycle_end_date.slice(0, 10) : null);

  // 5. Unified Cycle Status
  const isOverdue = !isPaid && deliveredMeals >= totalMeals;
  const status: CustomerLiveMetrics['status'] = isPaid
    ? 'paid'
    : isOverdue
      ? 'overdue'
      : 'due';

  const isLastDay = Boolean(effectiveEndDate && effectiveEndDate === todayDateKey);

  return {
    totalMeals,
    deliveredMeals,
    remainingMeals,
    graceMeals,
    effectiveEndDate,
    status,
    isLastDay,
  };
}