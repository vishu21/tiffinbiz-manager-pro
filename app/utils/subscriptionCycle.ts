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
  // Optional: defaults to the canonical Mon–Fri plan.
  deliveryDays?: Set<number> | null;
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

  const deliveryDays =
    input.deliveryDays && input.deliveryDays.size > 0
      ? input.deliveryDays
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
