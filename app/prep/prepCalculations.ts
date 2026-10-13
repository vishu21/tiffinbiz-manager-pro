// ─────────────────────────────────────────────────────────────────────────────
// PURE PREP CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
// Every count, volume, and PACK metric on the Prep dashboard is derived here by
// iterating the ACTIVE (already date-filtered) customer list exactly once. Nothing
// is hardcoded: the same reducer produces correct totals for 5, 17, or 500 rows.
//
// Per-customer "what do we actually pack today?" resolution precedence:
//   1. Structured `curry_config` JSON (weekly M/W/F + T/Th side profiles) — the
//      group matching the selected day's menu (M/W/F = chicken/non-veg menu,
//      T/Th = veg menu) is used.
//   2. Plain `delivery_instructions` count text (used by legacy rows and half
//      tiers, which do not carry a structured profile).
//   3. Diet + portion defaults (e.g. 1 Sabji + 1 Chicken for full Non-Veg).
// ─────────────────────────────────────────────────────────────────────────────

// ── Container volume reference ──────────────────────────────────────────────
export const CONTAINER_OZ = { LG: 12, RG: 8 } as const;
export type ContainerSize = keyof typeof CONTAINER_OZ;

const PORTION_RG = 'RG';
const PORTION_LG = 'LG';
const PORTION_HALF_RG = 'Half RG';
const PORTION_HALF_LG = 'Half LG';

const normalizePortionToken = (value: string | null | undefined): string => {
  const v = (value || '').trim().toUpperCase().split(' ').filter(Boolean).join(' ');
  if (v.startsWith('HALF')) {
    return v.includes('LG') || v.includes('LARGE') ? PORTION_HALF_LG : PORTION_HALF_RG;
  }
  if (v === 'LG' || v === 'LARGE') return PORTION_LG;
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG;
  return PORTION_RG;
};

const getPortionSize = (portionSize: string | null | undefined): ContainerSize => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_LG || p === PORTION_HALF_LG ? 'LG' : 'RG';
};

const isHalfPortion = (portionSize: string | null | undefined): boolean => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_HALF_LG || p === PORTION_HALF_RG;
};

// ── Types ───────────────────────────────────────────────────────────────────

export type CurryCounts = { dal: number; sabji: number; chicken: number; gravy: number };
export type RiceCounts = { rg: number; lg: number; xl: number };

// Complete day meal specification
export type DayMealPlan = {
  roti: number;
  pronthi: number;
  rice: string;
  dal: number;
  sabji: number;
  chicken: number;
  gravy: number;
  salad: number;
  dessert: number;
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

export type PrepCustomer = {
  meal_type?: string | null;
  portion_size?: string | null;
  delivery_instructions?: string | null;
  curry_config?: string | null;
  weekly_schedule_matrix?: string | null; // Universal day-by-day matrix (Mon through Sat)
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  dietary_notes?: string | null;
  notes?: string | null;
  side_notes?: string | null;
  custom_instructions?: string | null;
  isSkipped?: boolean;
  disliked_dishes?: string[] | null;
};

// ── Curry-count resolution helpers ──────────────────────────────────────────

type StructuredCurryConfig = { mwf: CurryCounts; tth: CurryCounts };

const EMPTY_CURRY: CurryCounts = { dal: 0, sabji: 0, chicken: 0, gravy: 0 };
const hasAnyCurry = (c: CurryCounts): boolean =>
  c.dal > 0 || c.sabji > 0 || c.chicken > 0 || c.gravy > 0;

const norm = (p: Partial<CurryCounts> | null | undefined): CurryCounts => ({
  dal: Number(p?.dal) || 0,
  sabji: Number(p?.sabji) || 0,
  chicken: Number(p?.chicken) || 0,
  gravy: Number(p?.gravy) || 0,
});

// ── Dish-exclusion resolution (disliked_dishes → automatic veg-side swap) ─────

export const normalizeDishName = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

type DishDislikeCustomer = Pick<
  PrepCustomer,
  'portion_size' | 'disliked_dishes' | 'dietary_notes' | 'delivery_instructions' | 'notes' | 'side_notes' | 'custom_instructions'
>;

const DISLIKE_TEXT_COLUMNS: (keyof DishDislikeCustomer)[] = [
  'dietary_notes',
  'delivery_instructions',
  'notes',
  'side_notes',
  'custom_instructions',
];

const dishNamePattern = (dishName: string | null | undefined): string =>
  normalizeDishName(dishName)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');

export function checkDishDislike(
  customer: DishDislikeCustomer,
  dishName: string | null | undefined
): boolean {
  const dishKey = normalizeDishName(dishName);
  if (dishKey === '') return false;

  const disliked = (customer.disliked_dishes || []).map(normalizeDishName).filter(Boolean);
  if (disliked.some(entry => entry === dishKey || entry.includes(dishKey) || dishKey.includes(entry))) {
    return true;
  }

  const text = DISLIKE_TEXT_COLUMNS
    .map(col => String(customer[col] ?? '').trim())
    .filter(t => t !== '' && t !== 'None' && t !== '—')
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (text === '') return false;

  const dishPattern = dishNamePattern(dishName);
  return (
    new RegExp(`\\bno\\s+${dishPattern}\\b`).test(text) ||
    new RegExp(`\\bdislikes?\\s+${dishPattern}\\b`).test(text)
  );
}

export type DishExclusionMatch = {
  dislikesDal: boolean;
  dislikesSabji: boolean;
  swapTo: 'dal' | 'sabji' | 'none' | 'unresolved';
  badge: string | null;
};

export function resolveDishExclusion(
  customer: DishDislikeCustomer,
  todayDalName?: string | null,
  todaySabjiName?: string | null
): DishExclusionMatch {
  const dalKey = normalizeDishName(todayDalName);
  const sabjiKey = normalizeDishName(todaySabjiName);

  const dislikesDal = dalKey !== '' && checkDishDislike(customer, todayDalName);
  const dislikesSabji = sabjiKey !== '' && checkDishDislike(customer, todaySabjiName);
  const isHalf = isHalfPortion(customer.portion_size);

  if (dislikesDal && dislikesSabji) {
    return {
      dislikesDal: true,
      dislikesSabji: true,
      swapTo: 'unresolved',
      badge: `⚠️ No ${todayDalName} & ${todaySabjiName} — Kitchen override`,
    };
  }
  if (dislikesSabji) {
    return {
      dislikesDal: false,
      dislikesSabji: true,
      swapTo: 'dal',
      badge: isHalf ? `⚡ No ${todaySabjiName} → 1 Dal` : `⚡ No ${todaySabjiName} → 2x Dal`,
    };
  }
  if (dislikesDal) {
    return {
      dislikesDal: true,
      dislikesSabji: false,
      swapTo: 'sabji',
      badge: isHalf ? `⚡ No ${todayDalName} → 1 Sabji` : `⚡ No ${todayDalName} → 2x Sabji`,
    };
  }
  return { dislikesDal: false, dislikesSabji: false, swapTo: 'none', badge: null };
}

export function getDishDislikeAlert(
  customer: DishDislikeCustomer,
  todayDalName?: string | null,
  todaySabjiName?: string | null
): string | null {
  return resolveDishExclusion(customer, todayDalName, todaySabjiName).badge;
}

const parseStructuredCurryConfig = (raw: string | null | undefined): StructuredCurryConfig | null => {
  const trimmed = String(raw || '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      mwf?: Partial<CurryCounts> | null;
      tth?: Partial<CurryCounts> | null;
    };
    if (!parsed || !parsed.mwf || !parsed.tth) return null;
    return { mwf: norm(parsed.mwf), tth: norm(parsed.tth) };
  } catch {
    return null;
  }
};

const defaultCurryCounts = (isNonVeg: boolean, portion: string): CurryCounts => {
  if (isHalfPortion(portion)) {
    return isNonVeg
      ? { dal: 0, sabji: 0, chicken: 1, gravy: 0 }
      : { dal: 1, sabji: 0, chicken: 0, gravy: 0 };
  }
  return isNonVeg
    ? { dal: 0, sabji: 1, chicken: 1, gravy: 0 }
    : { dal: 1, sabji: 1, chicken: 0, gravy: 0 };
};

const extractCurryCount = (text: string, keyword: string): number => {
  const xMatch = text.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}\\b`, 'i'));
  if (xMatch) return parseInt(xMatch[1], 10);
  const plainMatch = text.match(new RegExp(`(\\d+)\\s*${keyword}\\b`, 'i'));
  if (plainMatch) return parseInt(plainMatch[1], 10);
  if (text.includes(`both ${keyword}`)) return 2;
  return text.includes(keyword) ? 1 : 0;
};

const parseCurryCounts = (instructions: string | null | undefined): CurryCounts => {
  const text = String(instructions || '').trim().toLowerCase();
  if (!text || text === 'none' || text === '—') return { ...EMPTY_CURRY };
  return {
    dal: extractCurryCount(text, 'dal'),
    sabji: extractCurryCount(text, 'sabji'),
    chicken: extractCurryCount(text, 'chicken'),
    gravy: extractCurryCount(text, 'gravy'),
  };
};

// ── Side add-on (Salad / Dessert) detection ──────────────────────────────────

const sideAddonMarkerText = (customer: PrepCustomer): string =>
  [
    customer.curry_config,
    customer.delivery_instructions,
    customer.dietary_notes,
    customer.notes,
    customer.side_notes,
    customer.custom_instructions,
  ]
    .filter((v): v is string => {
      const t = String(v || '').trim();
      return t !== '' && t !== 'None' && t !== '—';
    })
    .map(v => v.trim())
    .join(' ');

const extractSideAddonCount = (text: string, keyword: string): number => {
  const haystack = ` ${text.toLowerCase()} `;
  if (!haystack.includes(keyword)) return 0;
  let max = 0;
  const absorbMatches = (pattern: RegExp): void => {
    for (const match of haystack.matchAll(pattern)) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  };
  absorbMatches(new RegExp(`(\\d+)\\s*x\\s*${keyword}`, 'g'));
  absorbMatches(new RegExp(`(\\d+)\\s*${keyword}`, 'g'));
  return max > 0 ? max : 1;
};

export const resolveSideAddons = (customer: PrepCustomer): { salad: number; dessert: number } => {
  const portion = normalizePortionToken(customer.portion_size);
  const isFullLg = portion === PORTION_LG;
  const isHalf = isHalfPortion(customer.portion_size);

  let salad = isFullLg ? 1 : 0;
  let dessert = isFullLg ? 1 : 0;

  if (customer.curry_config && customer.curry_config.startsWith('{')) {
    try {
      const parsed = JSON.parse(customer.curry_config);
      if (Array.isArray(parsed.extras)) {
        parsed.extras.forEach((extra: string) => {
          const lower = extra.toLowerCase();
          if (lower.includes('no salad')) salad = 0;
          else if (lower.includes('no dessert')) dessert = 0;
          else if (lower.includes('salad')) {
            const m = lower.match(/(\d+)\s*x?\s*salad/);
            salad = m ? parseInt(m[1], 10) : 1;
          } else if (lower.includes('dessert')) {
            const m = lower.match(/(\d+)\s*x?\s*dessert/);
            dessert = m ? parseInt(m[1], 10) : 1;
          }
        });
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const text = sideAddonMarkerText(customer);
  const lowerText = ` ${text.toLowerCase()} `;

  if (/\bno\s+salad\b/.test(lowerText)) {
    salad = 0;
  } else {
    const textSaladCount = extractSideAddonCount(text, 'salad');
    if (textSaladCount > 0) {
      salad = Math.max(salad, textSaladCount);
    }
  }

  if (/\bno\s+dessert\b/.test(lowerText)) {
    dessert = 0;
  } else {
    const textDessertCount = extractSideAddonCount(text, 'dessert');
    if (textDessertCount > 0) {
      dessert = Math.max(dessert, textDessertCount);
    }
  }

  if (isHalf && !customer.curry_config?.includes('Salad') && !lowerText.includes('salad')) {
    salad = 0;
  }
  if (isHalf && !customer.curry_config?.includes('Dessert') && !lowerText.includes('dessert')) {
    dessert = 0;
  }

  return { salad, dessert };
};

const resolveCurryCounts = (customer: PrepCustomer, isChickenDay: boolean): CurryCounts => {
  const isNonVeg = String(customer.meal_type || '').toLowerCase().includes('non');
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) {
    return isChickenDay ? { ...structured.mwf } : { ...structured.tth };
  }
  const parsed = parseCurryCounts(customer.delivery_instructions);
  if (hasAnyCurry(parsed)) return parsed;
  return defaultCurryCounts(isNonVeg, String(customer.portion_size || ''));
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

// ── Weekly Starch Split Resolution Helper ───────────────────────────────────

/**
 * Resolves a customer's meal plan for the target day of the week.
 * 1. If weekly_schedule_matrix is set and enabled, uses that day's specific custom plan.
 * 2. Otherwise falls back to base configs (curry_config, instructions, and profile defaults).
 */
export function resolveCustomerDayPlan(
  customer: PrepCustomer,
  activeDay?: string | null,
  isChickenDay: boolean = false
): DayMealPlan {
  const dayKey = activeDay || 'Monday';

  // 1. Day-by-Day schedule matrix check
  if (customer.weekly_schedule_matrix && customer.weekly_schedule_matrix.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(customer.weekly_schedule_matrix);
      if (parsed.is_custom_schedule && parsed.days && parsed.days[dayKey]) {
        const d = parsed.days[dayKey];
        return {
          roti: typeof d.roti === 'number' ? d.roti : (customer.roti_count ?? 8),
          pronthi: typeof d.pronthi === 'number' ? d.pronthi : (customer.pronthi_count ?? 0),
          rice: d.rice || customer.rice_count || 'None',
          dal: typeof d.dal === 'number' ? d.dal : 1,
          sabji: typeof d.sabji === 'number' ? d.sabji : 1,
          chicken: typeof d.chicken === 'number' ? d.chicken : 0,
          gravy: typeof d.gravy === 'number' ? d.gravy : 0,
          salad: typeof d.salad === 'number' ? d.salad : 0,
          dessert: typeof d.dessert === 'number' ? d.dessert : 0,
        };
      }
    } catch {
      // Fallback on JSON parse error
    }
  }

  // 2. Base profile resolution
  const curries = resolveCurryCounts(customer, isChickenDay);
  const addons = resolveSideAddons(customer);

  return {
    roti: customer.roti_count ?? 8,
    pronthi: customer.pronthi_count ?? 0,
    rice: customer.rice_count || 'None',
    dal: curries.dal,
    sabji: curries.sabji,
    chicken: curries.chicken,
    gravy: curries.gravy,
    salad: addons.salad,
    dessert: addons.dessert,
  };
}

// ── Engine ──────────────────────────────────────────────────────────────────

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

    // Resolve this customer's exact plan for this day
    const dayPlan = resolveCustomerDayPlan(customer, dayName, isChickenDay);

    acc.saladCount += dayPlan.salad;
    acc.dessertCount += dayPlan.dessert;

    const exclusion = resolveDishExclusion(customer, todayDalName, todaySabjiName);
    const dislikesDal = exclusion.dislikesDal;
    const dislikesSabji = exclusion.dislikesSabji;

    let finalDal = dayPlan.dal;
    let finalSabji = dayPlan.sabji;
    let swappedTo: 'dal' | 'sabji' | null = null;

    if (!isChickenDay || !isNonVeg) {
      if (isHalf) {
        const prefersSabji = dayPlan.sabji > 0 && dayPlan.dal === 0;
        const assignedSabji = prefersSabji ? 1 : 0;
        const assignedDal = prefersSabji ? 0 : 1;

        if (dislikesSabji && !dislikesDal && assignedSabji > 0) {
          finalDal = 1;
          finalSabji = 0;
          swappedTo = 'dal';
        } else if (dislikesDal && !dislikesSabji && assignedDal > 0) {
          finalSabji = 1;
          finalDal = 0;
          swappedTo = 'sabji';
        } else {
          finalDal = assignedDal;
          finalSabji = assignedSabji;
        }
      } else {
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

    // Chicken day routing for Non-Veg customer
    const chickenContainers = dayPlan.chicken;
    const gravyContainers = dayPlan.gravy;

    if (chickenContainers + gravyContainers === 0) {
      const baseDal = dayPlan.dal || 1;
      const baseSabji = dayPlan.sabji || 1;

      if (dislikesSabji && !dislikesDal) {
        finalDal = baseDal + baseSabji;
        swappedTo = 'dal';
      } else if (dislikesDal && !dislikesSabji) {
        finalSabji = baseDal + baseSabji;
        swappedTo = 'sabji';
      } else {
        finalDal = baseDal;
        finalSabji = baseSabji;
      }

      recordDishSwap(acc, swappedTo, exclusion, finalDal + finalSabji > 0);
      addSabji(acc, size, finalSabji, ozPerContainer);
      addDal(acc, size, finalDal, ozPerContainer);
      return acc;
    }

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