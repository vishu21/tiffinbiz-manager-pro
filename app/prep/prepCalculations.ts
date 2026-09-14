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
// Physical container sizes used by the metric cards:
//   LG container = 12 oz (Full LG AND Half LG both pack the 12 oz container)
//   RG container = 8 oz  (Full RG AND Half RG — incl. legacy SM/SMALL — pack the 8 oz)
// There is intentionally NO "SM" container: legacy SM customers are re-bucketed
// into the RG 8 oz half tier. The PACK columns only ever show LG (12 oz) / RG (8 oz).
export const CONTAINER_OZ = { LG: 12, RG: 8 } as const;
export type ContainerSize = keyof typeof CONTAINER_OZ;

const PORTION_RG = 'RG';
const PORTION_LG = 'LG';
const PORTION_HALF_RG = 'Half RG';
const PORTION_HALF_LG = 'Half LG';

// Canonical portion-token normalization (mirrors the prep manifest / customer
// editor vocabulary: "Large" == "LG", "SMALL" == "Half RG", ...).
const normalizePortionToken = (value: string | null | undefined): string => {
  const v = (value || '').trim().toUpperCase().split(' ').filter(Boolean).join(' ');
  if (v.startsWith('HALF')) {
    return v.includes('LG') || v.includes('LARGE') ? PORTION_HALF_LG : PORTION_HALF_RG;
  }
  if (v === 'LG' || v === 'LARGE') return PORTION_LG;
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG; // legacy 1x 8oz
  return PORTION_RG; // RG / REGULAR / empty -> full regular
};

// Portion tier → container-size bucket for packing/volume math.
const getPortionSize = (portionSize: string | null | undefined): ContainerSize => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_LG || p === PORTION_HALF_LG ? 'LG' : 'RG';
};

// Half tiers (Half LG / Half RG — incl. legacy SM/SMALL) pack exactly ONE container/day.
const isHalfPortion = (portionSize: string | null | undefined): boolean => {
  const p = normalizePortionToken(portionSize);
  return p === PORTION_HALF_LG || p === PORTION_HALF_RG;
};

// ── Types ───────────────────────────────────────────────────────────────────

// Curry-side count vocabulary shared by delivery_instructions text and the
// structured curry_config profiles (M/W/F + T/Th day groups).
export type CurryCounts = { dal: number; sabji: number; chicken: number; gravy: number };

export type RiceCounts = { rg: number; lg: number; xl: number };

// The complete, fully-dynamic metric set the dashboard renders. Every pack field
// is the count of PHYSICAL containers of that item/size (never customers).
export type PrepMetrics = {
  totalMeals: number;
  totalRoti: number;
  totalPronthi: number;
  rice: RiceCounts;
  totalRiceContainers: number;

  // Veg-station items — itemized PACK (LG 12 oz / RG 8 oz) + cooking volume (oz)
  sabjiPackLG: number;
  sabjiPackRG: number;
  sabjiOz: number;
  dalPackLG: number;
  dalPackRG: number;
  dalOz: number;

  // Chicken-station chicken — PACK, volume, and leg count (LG = 2 legs/container).
  chickenPackLG: number;
  chickenPackRG: number;
  chickenOz: number;
  chickenLegs: number;

  // Gravy variants are also cooked/packed at the Chicken station but never carry legs.
  gravyPackLG: number;
  gravyPackRG: number;
  gravyOz: number;

  // Side add-on staging counts — the total number of Salad containers and Dessert
  // cups to pull. Derived dynamically from each active customer's Salad/Dessert
  // markers (case-insensitive) across notes, daily overrides, and meal configs.
  saladCount: number;
  dessertCount: number;
};

// Minimal row shape the engine needs. The prep page passes its active customers;
// because every field below is optional, any superset customer row is accepted.
export type PrepCustomer = {
  meal_type?: string | null;
  portion_size?: string | null;
  delivery_instructions?: string | null;
  curry_config?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  // Free-text note columns searched for Salad/Dessert markers alongside the meal
  // config above (daily overrides are already merged into the row before this
  // engine runs, so a "Today Only" note/override is picked up automatically).
  dietary_notes?: string | null;
  notes?: string | null;
  side_notes?: string | null;
  custom_instructions?: string | null;
  // Single-day skip: the customer has an active date-scoped override with
  // is_skipped === true for the target date. A skipped customer contributes NOTHING to
  // any cooking total, the itemized PACK counts, or the active-delivery count — the
  // manifest still renders the row (muted) for the packer, but the kitchen never preps it.
  isSkipped?: boolean;
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

// Parses a structured `curry_config` JSON value ({ mwf, tth, extras }). Returns
// null for legacy plain-text configs and malformed values (treated as "no profile").
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
    return null; // ignore malformed JSON
  }
};

// Auto-applied defaults when a row carries no instructions/profile at all.
// Mirrors the customer editor / quick-edit defaults: full plans → two containers,
// Half plans → one container.
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

// Counts one ingredient out of instruction text. Same vocabulary as the rest of
// the app: "2x Dal", "2 Dal", "both Dal", or a bare mention (1).
const extractCurryCount = (text: string, keyword: string): number => {
  const xMatch = text.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}\\b`, 'i'));
  if (xMatch) return parseInt(xMatch[1], 10);
  const plainMatch = text.match(new RegExp(`(\\d+)\\s*${keyword}\\b`, 'i'));
  if (plainMatch) return parseInt(plainMatch[1], 10);
  if (text.includes(`both ${keyword}`)) return 2;
  return text.includes(keyword) ? 1 : 0;
};

// Parses the plain daily count text stored in delivery_instructions.
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
// Salad and Dessert are optional per-customer add-ons that surface as text markers
// on any of the surfaces the manifest can see:
//   · the plain `delivery_instructions` summary ("1 Dal + 1 Sabji + Salad + Dessert (weekly)")
//   · the structured `curry_config` JSON `extras` array (["2x Salad", "Dessert"])
//   · free-text note / daily-override columns ("dietary_notes", "notes", ...)
// Because the structured profile and the plain instruction text MIRROR the same
// add-on (both editors write them together), every surface is scanned as ONE
// haystack and the LARGEST explicit count wins ("2x Salad" beats a bare "+ Salad").
// Mirrored fields therefore never double-count a single customer.
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

// Reads one add-on ("salad" / "dessert") out of the combined marker haystack,
// case-insensitively: "2x Salad" → 2, "2 Salad" → 2, bare "Salad" / "+ Salad" → 1,
// and no mention → 0.
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

// The customer's Salad container / Dessert cup quantities for the selected day.
export const resolveSideAddons = (customer: PrepCustomer): { salad: number; dessert: number } => {
  const text = sideAddonMarkerText(customer);
  return {
    salad: extractSideAddonCount(text, 'salad'),
    dessert: extractSideAddonCount(text, 'dessert'),
  };
};

// The customer's TRUE side allocation for the selected day. Structured profiles
// win because they are day-group aware (a custom T/Th "2x Dal" would otherwise be
// lost when the same delivery_instructions row only mirrors the M/W/F meal).
const resolveCurryCounts = (customer: PrepCustomer, isChickenDay: boolean): CurryCounts => {
  const isNonVeg = String(customer.meal_type || '').toLowerCase().includes('non');
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) {
    // M/W/F group on non-veg menu days, T/Th group on veg menu days. veg_fixed
    // profiles store the same veg meal in both groups, so the day-group pick holds
    // for Veg customers as well.
    return isChickenDay ? { ...structured.mwf } : { ...structured.tth };
  }
  const parsed = parseCurryCounts(customer.delivery_instructions);
  if (hasAnyCurry(parsed)) return parsed;
  return defaultCurryCounts(isNonVeg, String(customer.portion_size || ''));
};

// ── Meal shaping (tier-aware container counts) ──────────────────────────────

// Veg-station meal for a day/menu where this customer eats veg:
//   Full tier = exactly two containers (1 Dal + 1 Sabji default; a stored
//   2x Sabji / 2x Dal profile overrides the split).
//   Half tier = exactly ONE container (Sabji only when the row explicitly asks for
//   Sabji; otherwise the standard single Dal container).
const shapeVegMeal = (
  counts: CurryCounts,
  isHalf: boolean
): { dal: number; sabji: number } => {
  if (isHalf) {
    if (counts.sabji > 0 && counts.dal === 0) return { dal: 0, sabji: 1 };
    return { dal: 1, sabji: 0 };
  }
  if (counts.dal + counts.sabji >= 2) return { dal: counts.dal, sabji: counts.sabji };
  return { dal: 1, sabji: 1 };
};

// The single veg-side container a FULL non-veg meal sends to the Veg station on a
// chicken day: Dal when the profile requests "1 Dal + 1 Chicken", Sabji by default
// ("1 Sabji + 1 Chicken"). Doubled chicken/gravy meals send no veg side at all.
const shapeNonVegVegSide = (counts: CurryCounts): { dal: number; sabji: number } => {
  if (counts.dal > 0 && counts.sabji === 0) return { dal: 1, sabji: 0 };
  if (counts.sabji > 0) return { dal: 0, sabji: 1 };
  return { dal: 0, sabji: 0 };
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
});

/**
 * Computes every dynamic prep metric by walking the ACTIVE customer list for the
 * selected date. `isChickenDay` selects the M/W/F (non-veg) menu vs the T/Th (veg)
 * menu routing matrix:
 *   - Veg menu day (or a Veg customer on any day)  → all sides route to the Veg pool.
 *   - Non-Veg customer on a chicken day            → chicken/gravy containers route
 *     to the Chicken station; a full meal also sends its one veg-side container to
 *     the Veg station.
 */
export function computePrepMetrics(customers: PrepCustomer[], isChickenDay: boolean): PrepMetrics {
  const metrics = customers.reduce((acc, customer) => {
    // 0. Single-day skip: the customer's meal is skipped for this date, so NOTHING is
    //    cooked or packed for them (roti, pronthi, rice, sabji, dal, chicken, legs,
    //    salad, dessert) and they never reach any station branch below.
    if (customer.isSkipped) return acc;

    // 1. Determine the physical container this customer packs (LG = 12 oz, RG = 8 oz).
    const size = getPortionSize(customer.portion_size);
    const ozPerContainer = CONTAINER_OZ[size];
    const isHalf = isHalfPortion(customer.portion_size);
    const isNonVeg = String(customer.meal_type || '').toLowerCase().includes('non');
    const legsPerContainer = size === 'LG' ? 2 : 1; // 2 legs per 12oz LG, 1 per 8oz RG

    // 2. True side counts for today (structured profile → instructions → defaults).
    const counts = resolveCurryCounts(customer, isChickenDay);

    // 2b. Salad / Dessert add-on staging — counted ONCE per active customer from
    //     the combined meal-config + note + (merged) override marker text. Runs
    //     before the routing branches below so every row contributes, veg or not.
    const addons = resolveSideAddons(customer);
    acc.saladCount += addons.salad;
    acc.dessertCount += addons.dessert;

    // 3. Accumulate dynamically.
    if (!isChickenDay || !isNonVeg) {
      // ══════════════════════════════════════════════════════════════════
      // VEG ROUTING — a veg menu day routes every customer to the Veg pool;
      // a Veg customer packs veg on chicken days too. Dal & Sabji only.
      // ══════════════════════════════════════════════════════════════════
      const sides = shapeVegMeal(counts, isHalf);
      addSabji(acc, size, sides.sabji, ozPerContainer);
      addDal(acc, size, sides.dal, ozPerContainer);
      return acc;
    }

    // ══════════════════════════════════════════════════════════════════
    // CHICKEN ROUTING — Non-Veg customer on a non-veg menu day.
    // ══════════════════════════════════════════════════════════════════
    const chickenContainers = counts.chicken;
    const gravyContainers = counts.gravy;

    // Legacy safety: a Non-Veg customer with no chicken/gravy allocation at all
    // (an old all-veg instruction row) still receives a normal veg meal.
    if (chickenContainers + gravyContainers === 0) {
      const sides = shapeVegMeal(counts, isHalf);
      addSabji(acc, size, sides.sabji, ozPerContainer);
      addDal(acc, size, sides.dal, ozPerContainer);
      return acc;
    }

    addChicken(acc, size, chickenContainers, ozPerContainer, legsPerContainer);
    addGravy(acc, size, gravyContainers, ozPerContainer);

    // Full non-veg meals pack their single veg-side container at the Veg station;
    // Half non-veg meals pack ONLY the chicken container.
    if (!isHalf) {
      const side = shapeNonVegVegSide(counts);
      addSabji(acc, size, side.sabji, ozPerContainer);
      addDal(acc, size, side.dal, ozPerContainer);
    }
    return acc;
  }, emptyMetrics());

  // ── Carb (roti / pronthi / rice) aggregation — unchanged dynamic totals ──
  // Skipped customers are excluded from the active-delivery count entirely.
  metrics.totalMeals = customers.filter(customer => !customer.isSkipped).length;
  customers.forEach(customer => {
    if (customer.isSkipped) return;
    if (customer.roti_count) metrics.totalRoti += customer.roti_count;
    if (customer.pronthi_count) metrics.totalPronthi += customer.pronthi_count;
    if (customer.rice_count && customer.rice_count !== 'None' && customer.rice_count !== '—') {
      customer.rice_count.split('+').forEach(token => {
        const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/);
        if (m) {
          const qty = parseInt(m[1], 10);
          const size = m[2] as keyof RiceCounts;
          metrics.rice[size] += qty;
        }
      });
    }
  });
  metrics.totalRiceContainers = metrics.rice.rg + metrics.rice.lg + metrics.rice.xl;

  return metrics;
}



