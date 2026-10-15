// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL MEAL & CONTAINER ENGINE (SINGLE SOURCE OF TRUTH)
// ─────────────────────────────────────────────────────────────────────────────
// All customer day plan resolution, portion normalization, curry rules,
// side addons, dish dislike exclusions, and bread/rice formatters live here.
// Any page or calculation requiring meal specifications should import from here.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTAINER_OZ = { LG: 12, RG: 8 } as const;
export type ContainerSize = keyof typeof CONTAINER_OZ;

export const PORTION_RG = 'RG';
export const PORTION_LG = 'LG';
export const PORTION_HALF_RG = 'Half RG';
export const PORTION_HALF_LG = 'Half LG';

export const PORTION_ROTI_DEFAULTS: Record<string, number> = {
  [PORTION_LG]: 8,
  [PORTION_RG]: 6,
  [PORTION_HALF_LG]: 5,
  [PORTION_HALF_RG]: 4,
};

// ── 1. Portion Normalization Helpers ─────────────────────────────────────────

export const normalizePortionToken = (value: string | null | undefined): string => {
  const v = (value || '').trim().toUpperCase().split(' ').filter(Boolean).join(' ');
  if (v.startsWith('HALF')) {
    return v.includes('LG') || v.includes('LARGE') ? PORTION_HALF_LG : PORTION_HALF_RG;
  }
  if (v === 'LG' || v === 'LARGE') return PORTION_LG;
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG;
  return PORTION_RG;
};

export const formatPortionLabel = (value: string | null | undefined): string =>
  normalizePortionToken(value);

export const getPortionSize = (portionSize: string | null | undefined): ContainerSize => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_LG || p === PORTION_HALF_LG ? 'LG' : 'RG';
};

export const isHalfPortion = (portionSize: string | null | undefined): boolean => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_HALF_LG || p === PORTION_HALF_RG;
};

export const getDefaultRotiCount = (portion: string | null | undefined): number =>
  PORTION_ROTI_DEFAULTS[normalizePortionToken(portion)] ?? PORTION_ROTI_DEFAULTS[PORTION_RG];

// ── 2. Types ─────────────────────────────────────────────────────────────────

export type CurryCounts = {
  dal: number;
  sabji: number;
  chicken: number;
  gravy: number;
};

export type RiceCounts = {
  rg: number;
  lg: number;
  xl: number;
};

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

export type BaseCustomerMealFields = {
  meal_type?: string | null;
  portion_size?: string | null;
  delivery_instructions?: string | null;
  curry_config?: string | null;
  weekly_schedule_matrix?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  dietary_notes?: string | null;
  notes?: string | null;
  side_notes?: string | null;
  custom_instructions?: string | null;
  disliked_dishes?: string[] | null;
};

// ── 3. Display Formatters ───────────────────────────────────────────────────

export const hasRiceToPack = (value: string | null | undefined): boolean => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'none' || text === '—' || text === '0') return false;
  return text.split('+').some(token => {
    const m = token.trim().match(/^(\d+)\s*(?:rg|lg|xl)$/);
    return m !== null && parseInt(m[1], 10) > 0;
  });
};

export const formatShortRice = (riceCount: string | null | undefined): string => {
  if (!hasRiceToPack(riceCount)) return '—';
  const parts: string[] = [];
  String(riceCount)
    .split('+')
    .forEach(token => {
      const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/i);
      if (!m) return;
      const qty = parseInt(m[1], 10);
      if (qty <= 0) return;
      const size = m[2].toLowerCase() === 'xl' ? 'XL' : m[2].toLowerCase() === 'lg' ? 'Lg' : 'Rg';
      parts.push(`${qty} ${size}`);
    });
  return parts.length > 0 ? parts.join(' + ') : String(riceCount).trim();
};

export const formatBreadDisplay = (roti: number, pronthi: number): string => {
  const breadParts: string[] = [];
  if (roti > 0) breadParts.push(`${roti} Roti`);
  if (pronthi > 0) breadParts.push(`${pronthi} Pronthi`);
  return breadParts.length > 0 ? breadParts.join(' + ') : '—';
};

export const formatSidesBadge = (salad: number, dessert: number): string => {
  const parts: string[] = [];
  if (salad > 0) parts.push(salad > 1 ? `${salad}S` : 'S');
  if (dessert > 0) parts.push(dessert > 1 ? `${dessert}D` : 'D');
  return parts.length > 0 ? parts.join('+') : '—';
};

// ── 4. Side Add-on (Salad / Dessert) Resolution ──────────────────────────────

const sideAddonMarkerText = (customer: BaseCustomerMealFields): string =>
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

export const resolveSideAddons = (customer: BaseCustomerMealFields): { salad: number; dessert: number } => {
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

// ── 5. Dish-Exclusion Resolution (disliked_dishes) ───────────────────────────

export const normalizeDishName = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const dishNamePattern = (dishName: string | null | undefined): string =>
  normalizeDishName(dishName)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');

export function checkDishDislike(
  customer: BaseCustomerMealFields,
  dishName: string | null | undefined
): boolean {
  const dishKey = normalizeDishName(dishName);
  if (dishKey === '') return false;

  const disliked = (customer.disliked_dishes || []).map(normalizeDishName).filter(Boolean);
  if (disliked.some(entry => entry === dishKey || entry.includes(dishKey) || dishKey.includes(entry))) {
    return true;
  }

  const text = [
    customer.dietary_notes,
    customer.delivery_instructions,
    customer.notes,
    customer.side_notes,
    customer.custom_instructions,
  ]
    .map(col => String(col ?? '').trim())
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
  customer: BaseCustomerMealFields,
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
  customer: BaseCustomerMealFields,
  todayDalName?: string | null,
  todaySabjiName?: string | null
): string | null {
  return resolveDishExclusion(customer, todayDalName, todaySabjiName).badge;
}

// ── 6. Base Curry Counts Resolution ──────────────────────────────────────────

const EMPTY_CURRY: CurryCounts = { dal: 0, sabji: 0, chicken: 0, gravy: 0 };

const hasAnyCurry = (c: CurryCounts): boolean =>
  c.dal > 0 || c.sabji > 0 || c.chicken > 0 || c.gravy > 0;

const norm = (p: Partial<CurryCounts> | null | undefined): CurryCounts => ({
  dal: Number(p?.dal) || 0,
  sabji: Number(p?.sabji) || 0,
  chicken: Number(p?.chicken) || 0,
  gravy: Number(p?.gravy) || 0,
});

const parseStructuredCurryConfig = (raw: string | null | undefined): { mwf: CurryCounts; tth: CurryCounts } | null => {
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

export const resolveCurryCounts = (customer: BaseCustomerMealFields, isChickenDay: boolean): CurryCounts => {
  const isNonVeg = String(customer.meal_type || '').toLowerCase().includes('non');
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) {
    return isChickenDay ? { ...structured.mwf } : { ...structured.tth };
  }
  const parsed = parseCurryCounts(customer.delivery_instructions);
  if (hasAnyCurry(parsed)) return parsed;
  return defaultCurryCounts(isNonVeg, String(customer.portion_size || ''));
};

// ── 7. Universal Customer Day Plan Resolver ─────────────────────────────────

/**
 * Single source of truth to resolve what is packed for any customer on a target day:
 * 1. Checks `weekly_schedule_matrix` (day-by-day customization).
 * 2. Falls back to base profile defaults.
 */
export function resolveCustomerDayPlan(
  customer: BaseCustomerMealFields,
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
          roti: typeof d.roti === 'number' ? d.roti : (customer.roti_count ?? 6),
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
    roti: customer.roti_count ?? 6,
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

// ── 8. Customer Contact & Location Utilities ────────────────────────────────

export const formatStreetOnlyAddress = (address: string | null | undefined): string => {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);

  const streetParts = parts.filter(part => {
    const p = part.toLowerCase();
    const isCity = p === 'london' || p === 'woodstock' || p === 'st. thomas' || p === 'st thomas';
    const isProvince = p === 'on' || p === 'ontario' || p === 'qc' || p === 'canada';
    const isPostal = /^[a-z]\d[a-z]\s?\d[a-z]\d$/i.test(part);
    return !isCity && !isProvince && !isPostal;
  });

  const baseStreet = streetParts.length > 0 ? streetParts.join(', ') : parts[0];
  return baseStreet.replace(/\s+(london|woodstock|st\.?\s*thomas)$/i, '').trim();
};

export const cleanPhoneNumberForWhatsApp = (phone: string | null | undefined): string => {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    digits = `1${digits}`;
  }
  return digits;
};

export const parseRiceQuantities = (value: string | null | undefined): RiceCounts => {
  const counts: RiceCounts = { rg: 0, lg: 0, xl: 0 };
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'none' || text === '—' || text === '0') return counts;

  text.split('+').forEach(token => {
    const m = token.trim().match(/^(\d+)\s*(?:x\s*)?(rg|lg|xl)\b/);
    if (!m) return;
    const qty = parseInt(m[1], 10);
    const size = m[2] as keyof RiceCounts;
    if (['rg', 'lg', 'xl'].includes(size) && qty > 0) {
      counts[size] += qty;
    }
  });

  return counts;
};