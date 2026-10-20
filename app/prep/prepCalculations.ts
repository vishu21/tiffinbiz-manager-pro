// ─────────────────────────────────────────────────────────────────────────────
// PURE PREP CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
// Re-exports pure customer meal resolution from @/app/utils/mealEngine and
// computes aggregated kitchen metrics (oz, pot targets, container totals).
// ─────────────────────────────────────────────────────────────────────────────

import {
  CONTAINER_OZ,
  type ContainerSize,
  type CurryCounts,
  type RiceCounts,
  type DayMealPlan,
  type BaseCustomerMealFields,
  formatPortionLabel,
  getPortionSize,
  isHalfPortion,
  getDefaultRotiCount,
  hasRiceToPack,
  formatShortRice,
  formatBreadDisplay,
  formatSidesBadge,
  resolveSideAddons,
  checkDishDislike,
  resolveDishExclusion,
  getDishDislikeAlert,
  resolveCurryCounts,
  resolveCustomerDayPlan,
  normalizeDishName,
  type DishExclusionMatch,
} from '@/app/utils/mealEngine';

// Re-export so any file importing from prepCalculations continues to work seamlessly
export {
  CONTAINER_OZ,
  type ContainerSize,
  type CurryCounts,
  type RiceCounts,
  type DayMealPlan,
  formatPortionLabel,
  getPortionSize,
  isHalfPortion,
  getDefaultRotiCount,
  hasRiceToPack,
  formatShortRice,
  formatBreadDisplay,
  formatSidesBadge,
  resolveSideAddons,
  checkDishDislike,
  resolveDishExclusion,
  getDishDislikeAlert,
  resolveCurryCounts,
  resolveCustomerDayPlan,
  normalizeDishName,
  type DishExclusionMatch,
};

export type PrepCustomer = BaseCustomerMealFields & {
  isSkipped?: boolean;
};

export type PrepMetrics = {
  totalMeals: number;
  totalRoti: number;
  totalPronthi: number;
  rice: RiceCounts;
  totalRiceContainers: number;

  sabjiPackLG: number;
  sabjiPackRG: number;
  sabjiOz: number;
  dalPackLG: number;
  dalPackRG: number;
  dalOz: number;

  chickenPackLG: number;
  chickenPackRG: number;
  chickenOz: number;
  chickenLegs: number;

  gravyPackLG: number;
  gravyPackRG: number;
  gravyOz: number;

  saladCount: number;
  dessertCount: number;

  dishSwapToDal: number;
  dishSwapToSabji: number;
  dishSwapUnresolved: number;
};

// ── Accumulator helpers ─────────────────────────────────────────────────────

const addSabji = (acc: PrepMetrics, size: ContainerSize, count: number, ozPerContainer: number): void => {
  if (count <= 0) return;
  if (size === 'LG') acc.sabjiPackLG += count;
  else acc.sabjiPackRG += count;
  acc.sabjiOz += count * ozPerContainer;
};

const addDal = (acc: PrepMetrics, size: ContainerSize, count: number, ozPerContainer: number): void => {
  if (count <= 0) return;
  if (size === 'LG') acc.dalPackLG += count;
  else acc.dalPackRG += count;
  acc.dalOz += count * ozPerContainer;
};

const addChicken = (
  acc: PrepMetrics,
  size: ContainerSize,
  count: number,
  ozPerContainer: number,
  legsPerContainer: number
): void => {
  if (count <= 0) return;
  if (size === 'LG') acc.chickenPackLG += count;
  else acc.chickenPackRG += count;
  acc.chickenOz += count * ozPerContainer;
  acc.chickenLegs += count * legsPerContainer;
};

const addGravy = (acc: PrepMetrics, size: ContainerSize, count: number, ozPerContainer: number): void => {
  if (count <= 0) return;
  if (size === 'LG') acc.gravyPackLG += count;
  else acc.gravyPackRG += count;
  acc.gravyOz += count * ozPerContainer;
};

const recordDishSwap = (
  acc: PrepMetrics,
  swappedTo: 'dal' | 'sabji' | null,
  exclusion: DishExclusionMatch,
  hadVegSides: boolean
): void => {
  if (swappedTo === 'dal') acc.dishSwapToDal += 1;
  else if (swappedTo === 'sabji') acc.dishSwapToSabji += 1;
  else if (exclusion.swapTo === 'unresolved' && hadVegSides) acc.dishSwapUnresolved += 1;
};

const emptyMetrics = (): PrepMetrics => ({
  totalMeals: 0,
  totalRoti: 0,
  totalPronthi: 0,
  rice: { rg: 0, lg: 0, xl: 0 },
  totalRiceContainers: 0,
  sabjiPackLG: 0,
  sabjiPackRG: 0,
  sabjiOz: 0,
  dalPackLG: 0,
  dalPackRG: 0,
  dalOz: 0,
  chickenPackLG: 0,
  chickenPackRG: 0,
  chickenOz: 0,
  chickenLegs: 0,
  gravyPackLG: 0,
  gravyPackRG: 0,
  gravyOz: 0,
  saladCount: 0,
  dessertCount: 0,
  dishSwapToDal: 0,
  dishSwapToSabji: 0,
  dishSwapUnresolved: 0,
});

export function computePrepMetrics(
  customers: PrepCustomer[],
  isChickenDay: boolean,
  menu?: { dalName?: string | null; sabjiName?: string | null },
  activeDay?: string | null
): PrepMetrics {
  const todayDalName = menu?.dalName ?? null;
  const todaySabjiName = menu?.sabjiName ?? null;
  const dayName = activeDay || 'Monday';

  const metrics = customers.reduce((acc, customer) => {
    if (customer.isSkipped) return acc;

    const size = getPortionSize(customer.portion_size);
    const ozPerContainer = CONTAINER_OZ[size];
    const isHalf = isHalfPortion(customer.portion_size);
    const isNonVeg = String(customer.meal_type || '').toLowerCase().includes('non');
    const legsPerContainer = size === 'LG' ? 2 : 1;

    // Resolve this customer's exact plan for this day via canonical engine
    const dayPlan = resolveCustomerDayPlan(customer, dayName, isChickenDay);

    acc.saladCount += dayPlan.salad;
    acc.dessertCount += dayPlan.dessert;

    const exclusion = resolveDishExclusion(customer, todayDalName, todaySabjiName);
    const dislikesDal = exclusion.dislikesDal;
    const dislikesSabji = exclusion.dislikesSabji;

    let finalDal = 0;
    let finalSabji = 0;
    let swappedTo: 'dal' | 'sabji' | null = null;

    // ─────────────────────────────────────────────────────────────────────────
    // A. VEG DAYS / NON-CHICKEN DAYS (Tuesday, Thursday, Weekends)
    // Chicken is IDLE. Both Veg & Non-Veg customers receive standard curries.
    // ─────────────────────────────────────────────────────────────────────────
    if (!isChickenDay) {
      if (isHalf) {
        // Half portion rule: 1 Sabji, 0 Dal (unless custom instructions explicitly say Dal)
        const wantsDalOnly = (dayPlan.dal > 0 && dayPlan.sabji === 0) || 
          /\b(only dal|1 dal|daal only)\b/i.test(customer.delivery_instructions || '');

        finalDal = wantsDalOnly ? 1 : 0;
        finalSabji = wantsDalOnly ? 0 : 1;

        if (dislikesSabji && !dislikesDal && finalSabji > 0) {
          finalDal = 1;
          finalSabji = 0;
          swappedTo = 'dal';
        } else if (dislikesDal && !dislikesSabji && finalDal > 0) {
          finalSabji = 1;
          finalDal = 0;
          swappedTo = 'sabji';
        }
      } else {
        // Full portion rule: Everyone (Veg + Non-Veg) gets 1 Dal + 1 Sabji.
        // Only deviate if the customer has explicit instructions for "2x Sabji" or "2x Dal" / "No Dal" / "No Sabji".
        const rawNotes = `${customer.delivery_instructions || ''} ${customer.notes || ''}`.toLowerCase();
        const wantsDoubleSabji = /\b(2x sabji|both sabji|no dal|no daal)\b/.test(rawNotes);
        const wantsDoubleDal = /\b(2x dal|both dal|2x daal|both daal|no sabji)\b/.test(rawNotes);

        if (wantsDoubleSabji) {
          finalDal = 0;
          finalSabji = 2;
        } else if (wantsDoubleDal) {
          finalDal = 2;
          finalSabji = 0;
        } else {
          finalDal = 1;
          finalSabji = 1;
        }

        // Dish dislike substitutions
        if (dislikesSabji && !dislikesDal && finalSabji > 0) {
          finalDal += finalSabji;
          finalSabji = 0;
          swappedTo = 'dal';
        } else if (dislikesDal && !dislikesSabji && finalDal > 0) {
          finalSabji += finalDal;
          finalDal = 0;
          swappedTo = 'sabji';
        }
      }

      recordDishSwap(acc, swappedTo, exclusion, finalDal + finalSabji > 0);
      addSabji(acc, size, finalSabji, ozPerContainer);
      addDal(acc, size, finalDal, ozPerContainer);
      return acc;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B. CHICKEN DAYS (Monday, Wednesday, Friday)
    // ─────────────────────────────────────────────────────────────────────────
    const chickenContainers = dayPlan.chicken;
    const gravyContainers = dayPlan.gravy;

    if (!isNonVeg || (chickenContainers + gravyContainers === 0)) {
      // Standard Veg Customer on Chicken Day
      if (isHalf) {
        finalDal = 0;
        finalSabji = 1;
      } else {
        finalDal = dayPlan.dal || 1;
        finalSabji = dayPlan.sabji || 1;
      }

      if (dislikesSabji && !dislikesDal && finalSabji > 0) {
        finalDal += finalSabji;
        finalSabji = 0;
        swappedTo = 'dal';
      } else if (dislikesDal && !dislikesSabji && finalDal > 0) {
        finalSabji += finalDal;
        finalDal = 0;
        swappedTo = 'sabji';
      }

      recordDishSwap(acc, swappedTo, exclusion, finalDal + finalSabji > 0);
      addSabji(acc, size, finalSabji, ozPerContainer);
      addDal(acc, size, finalDal, ozPerContainer);
      return acc;
    }

    // Active Non-Veg Customer on Chicken Day
    addChicken(acc, size, chickenContainers, ozPerContainer, legsPerContainer);
    addGravy(acc, size, gravyContainers, ozPerContainer);

    if (!isHalf) {
      const baseVegDal = dayPlan.dal > 0 && dayPlan.sabji === 0 ? 1 : 0;
      const baseVegSabji = baseVegDal === 1 ? 0 : 1;
      let nvVegDal = baseVegDal;
      let nvVegSabji = baseVegSabji;

      if (dislikesSabji && !dislikesDal) {
        nvVegDal = 1;
        nvVegSabji = 0;
        if (baseVegSabji > 0) swappedTo = 'dal';
      } else if (dislikesDal && !dislikesSabji) {
        nvVegDal = 0;
        nvVegSabji = 1;
        if (baseVegDal > 0) swappedTo = 'sabji';
      }

      recordDishSwap(acc, swappedTo, exclusion, nvVegDal + nvVegSabji > 0);
      addSabji(acc, size, nvVegSabji, ozPerContainer);
      addDal(acc, size, nvVegDal, ozPerContainer);
    }
    return acc;
  }, emptyMetrics());

  // Dynamic carb tallies resolved per day
  metrics.totalMeals = customers.filter(customer => !customer.isSkipped).length;
  customers.forEach(customer => {
    if (customer.isSkipped) return;
    const dayPlan = resolveCustomerDayPlan(customer, dayName, isChickenDay);

    if (dayPlan.roti) metrics.totalRoti += dayPlan.roti;
    if (dayPlan.pronthi) metrics.totalPronthi += dayPlan.pronthi;
    if (dayPlan.rice && dayPlan.rice !== 'None' && dayPlan.rice !== '—') {
      dayPlan.rice.split('+').forEach(token => {
        const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/i);
        if (m) {
          const qty = parseInt(m[1], 10);
          const size = m[2].toLowerCase() as keyof RiceCounts;
          metrics.rice[size] += qty;
        }
      });
    }
  });
  metrics.totalRiceContainers = metrics.rice.rg + metrics.rice.lg + metrics.rice.xl;

  return metrics;
}