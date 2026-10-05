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

  // Dish-exclusion substitutions — how many active customers had a disliked dish
  // match today's menu and consequently received a swapped container:
  //   dishSwapToDal  → disliked today's Sabji → their Sabji container became Dal
  //   dishSwapToSabji→ disliked today's Dal   → their Dal container became Sabji
  //   dishSwapUnresolved → disliked BOTH of today's veg dishes (kitchen override)
  dishSwapToDal: number;
  dishSwapToSabji: number;
  dishSwapUnresolved: number;
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
  // Master-profile dish dislikes/exclusions (customers.disliked_dishes). Matched
  // case-insensitively against TODAY'S selected Dal/Sabji names to auto-swap the
  // corresponding container to the other veg side (see resolveDishExclusion).
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
//
// Operators record the dishes a customer refuses on the customer profile
// (customers.disliked_dishes). When one of them matches TODAY'S selected Dal or
// Sabji, the engine reroutes that customer's container for the disliked item to
// the other veg side so they still receive a full meal of a dish they do eat:
//   • dislikes today's Sabji → their Sabji container becomes Dal   ("2x Dal")
//   • dislikes today's Dal   → their Dal container becomes Sabji   ("2x Sabji")
//   • dislikes BOTH sides    → no automatic swap; the kitchen must override.
// Matching is case-insensitive and whitespace-normalized ("Aloo  Baingan" matches
// "aloo baingan"): a customer's structured disliked_dishes list is checked for a
// full OR substring match, and the free-text note / instruction columns are scanned
// for "no <dish>" / "dislikes <dish>" phrasing (see checkDishDislike).
export const normalizeDishName = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Customer columns that may carry a free-text dish dislike ("no Aloo Baingan",
// "dislikes Karela") which the structured disliked_dishes list does not capture.
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

// Escapes a dish name for use inside a RegExp and relaxes internal whitespace so a
// note reading "no  Aloo  Baingan" still matches today's "Aloo Baingan".
const dishNamePattern = (dishName: string | null | undefined): string =>
  normalizeDishName(dishName)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');

/**
 * Single source of truth for "does this customer dislike <dish>?". Pure.
 *
 *  1. Structured list (customers.disliked_dishes): case-insensitive, whitespace-
 *     normalized FULL OR SUBSTRING match — a stored dislike of "Aloo Baingan" also
 *     matches today's "Aloo Baingan Curry" (and vice versa).
 *  2. Free-text fallback: scans dietary_notes / delivery_instructions / notes (and
 *     the other note columns) for "no <dish>" / "dislikes <dish>" phrasing.
 *
 * Consumed by resolveDishExclusion() to reroute the veg-side container to the other
 * side; reused by the packing manifest badges.
 */
export function checkDishDislike(
  customer: DishDislikeCustomer,
  dishName: string | null | undefined
): boolean {
  const dishKey = normalizeDishName(dishName);
  if (dishKey === '') return false;

  // 1. Structured disliked_dishes list — full or substring (either direction) match.
  const disliked = (customer.disliked_dishes || []).map(normalizeDishName).filter(Boolean);
  if (disliked.some(entry => entry === dishKey || entry.includes(dishKey) || dishKey.includes(entry))) {
    return true;
  }

  // 2. Free-text fallback across the note / instruction columns.
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
  // Which veg side the customer's container was routed to (or why it couldn't be).
  swapTo: 'dal' | 'sabji' | 'none' | 'unresolved';
  // Ready-to-render manifest alert. Full plans fold both containers into the
  // surviving side ("⚡ No Aloo Baingan → 2x Dal"); Half plans pack a single
  // container ("⚡ No Aloo Baingan → 1 Dal").
  badge: string | null;
};

/**
 * Resolves a customer's dish exclusions against today's menu. Pure — used both by
 * the prep calculator (to reroute containers) and the packing manifest (badge).
 */
export function resolveDishExclusion(
  customer: DishDislikeCustomer,
  todayDalName?: string | null,
  todaySabjiName?: string | null
): DishExclusionMatch {
  const dalKey = normalizeDishName(todayDalName);
  const sabjiKey = normalizeDishName(todaySabjiName);

  const dislikesDal = dalKey !== '' && checkDishDislike(customer, todayDalName);
  const dislikesSabji = sabjiKey !== '' && checkDishDislike(customer, todaySabjiName);

  // Half tiers (Half LG / Half RG) pack a SINGLE LG/8 oz container, so the swapped
  // side is a lone "1" — not the "2x" a full 1 Dal + 1 Sabji meal folds into. The
  // manifest badge must therefore read "→ 1 Dal" / "→ 1 Sabji" on Half plans.
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

/**
 * Convenience wrapper around resolveDishExclusion() for the packing manifest
 * (desktop rows, mobile cards AND the print-only roster). Returns the ready-to-render
 * alert string — e.g. "⚡ No Aloo Baingan → 2x Dal" on a Full plan or
 * "⚡ No Aloo Baingan → 1 Dal" on a Half plan — when one of the customer's excluded
 * dishes matches today's selected Dal/Sabji, otherwise null.
 */
export function getDishDislikeAlert(
  customer: DishDislikeCustomer,
  todayDalName?: string | null,
  todaySabjiName?: string | null
): string | null {
  return resolveDishExclusion(customer, todayDalName, todaySabjiName).badge;
}

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
  const portion = normalizePortionToken(customer.portion_size);
  const isFullLg = portion === PORTION_LG;
  const isHalf = isHalfPortion(customer.portion_size);

  // Standard Plan Baseline: Full Large (LG) includes 1 Salad & 1 Dessert by default
  let salad = isFullLg ? 1 : 0;
  let dessert = isFullLg ? 1 : 0;

  // 1. Check structured curry_config JSON extras first (takes highest precedence)
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

  // 2. Scan text markers (notes, overrides, custom instructions) for explicit additions or removals
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

  // Half-portion guard: single containers do not receive default full sides unless explicitly opted in
  if (isHalf && !customer.curry_config?.includes('Salad') && !lowerText.includes('salad')) {
    salad = 0;
  }
  if (isHalf && !customer.curry_config?.includes('Dessert') && !lowerText.includes('dessert')) {
    dessert = 0;
  }

  return { salad, dessert };
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

// ── Meal shaping is applied inline in computePrepMetrics() ───────────────────
// Tier-aware container shaping now runs in the same reducer pass that tallies the
// packs, so a dish-exclusion swap is ALWAYS deducted from the disliked side and added
// to the surviving side (shapeVegMeal / shapeNonVegVegSide / applyDishSwap were folded
// into the reducer for exactly this reason).

// Tracks substitution stats for the dashboard summary — counts a swap only when it
// actually moved containers, and flags the rare "dislikes both sides" override case.
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

/**
 * Computes every dynamic prep metric by walking the ACTIVE customer list for the
 * selected date. `isChickenDay` selects the M/W/F (non-veg) menu vs the T/Th (veg)
 * menu routing matrix:
 *   - Veg menu day (or a Veg customer on any day)  → all sides route to the Veg pool.
 *   - Non-Veg customer on a chicken day            → chicken/gravy containers route
 *     to the Chicken station; a full meal also sends its one veg-side container to
 *     the Veg station.
 *
 * `menu` carries the day's selected Dal / Sabji dish names; they are matched against
 * each customer's dish exclusions so a disliked container is rerouted to the other
 * veg side before the pack/volume totals are accumulated (the /prep batch scaling
 * then recalculates every raw ingredient off the swapped RG/LG container counts).
 */
export function computePrepMetrics(
  customers: PrepCustomer[],
  isChickenDay: boolean,
  menu?: { dalName?: string | null; sabjiName?: string | null }
): PrepMetrics {
  const todayDalName = menu?.dalName ?? null;
  const todaySabjiName = menu?.sabjiName ?? null;
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
    const baseCounts = resolveCurryCounts(customer, isChickenDay);

    // 2b. Salad / Dessert add-on staging — counted ONCE per active customer from
    //     the combined meal-config + note + (merged) override marker text. Runs
    //     before the routing branches below so every row contributes, veg or not.
    const addons = resolveSideAddons(customer);
    acc.saladCount += addons.salad;
    acc.dessertCount += addons.dessert;

    // 2c. Strict dish-dislike verification against TODAY's selected Dal/Sabji. The
    //     boolean pair drives the swap in every routing branch below (Sabji dislike →
    //     its containers become Dal; Dal dislike → they become Sabji). The exclusion
    //     object also feeds the swap tallies behind the dashboard summary banner.
    const exclusion = resolveDishExclusion(customer, todayDalName, todaySabjiName);
    const dislikesDal = exclusion.dislikesDal;
    const dislikesSabji = exclusion.dislikesSabji;

    // 3. Calculate the ACTUAL containers to pack today, applying the swap in the SAME
    //    pass so the pack tallies + pot oz targets always reflect the substitution.
    let finalDal = 0;
    let finalSabji = 0;
    let swappedTo: 'dal' | 'sabji' | null = null;

    if (!isChickenDay || !isNonVeg) {
      // ══════════════════════════════════════════════════════════════════
      // VEG ROUTING — a veg menu day routes every customer to the Veg pool;
      // a Veg customer packs veg on chicken days too. Dal & Sabji only.
      // ══════════════════════════════════════════════════════════════════
      if (isHalf) {
        // Half portion = exactly ONE container total (12 oz if LG, 8 oz if RG).
        // Determine whether the base choice was Sabji or Dal, then apply the swap.
        const baseIsSabji = baseCounts.sabji > 0 && baseCounts.dal === 0;
        const selectedSabji = baseIsSabji ? 1 : 0;
        const selectedDal = baseIsSabji ? 0 : 1;

        if (dislikesSabji && selectedSabji > 0) {
          // Disliked Sabji → the single container becomes Dal (drop 1 Sabji, add 1 Dal).
          finalDal = 1;
          swappedTo = 'dal';
        } else if (dislikesDal && selectedDal > 0) {
          // Disliked Dal → the single container becomes Sabji (drop 1 Dal, add 1 Sabji).
          finalSabji = 1;
          swappedTo = 'sabji';
        } else {
          finalDal = selectedDal;
          finalSabji = selectedSabji;
        }
      } else {
        // Full portion = exactly TWO containers total.
        let bDal = baseCounts.dal;
        let bSabji = baseCounts.sabji;
        if (bDal + bSabji < 2) {
          bDal = 1;
          bSabji = 1;
        }

        if (dislikesSabji && !dislikesDal && bSabji > 0) {
          // Disliked Sabji → fold its container(s) into Dal.
          finalDal = bDal + bSabji;
          finalSabji = 0;
          swappedTo = 'dal';
        } else if (dislikesDal && !dislikesSabji && bDal > 0) {
          // Disliked Dal → fold its container(s) into Sabji.
          finalSabji = bSabji + bDal;
          finalDal = 0;
          swappedTo = 'sabji';
        } else {
          finalDal = bDal;
          finalSabji = bSabji;
        }
      }

      recordDishSwap(acc, swappedTo, exclusion, finalDal + finalSabji > 0);
      addDal(acc, size, finalDal, ozPerContainer);
      addSabji(acc, size, finalSabji, ozPerContainer);
      return acc;
    }

    // ══════════════════════════════════════════════════════════════════
    // CHICKEN ROUTING — Non-Veg customer on a non-veg menu day.
    // ══════════════════════════════════════════════════════════════════
    const chickenContainers = baseCounts.chicken;
    const gravyContainers = baseCounts.gravy;

    // Legacy safety: a Non-Veg customer with no chicken/gravy allocation at all
    // (an old all-veg instruction row) still receives a normal veg meal.
    if (chickenContainers + gravyContainers === 0) {
      const bDal = baseCounts.dal || 1;
      const bSabji = baseCounts.sabji || 1;

      if (dislikesSabji && !dislikesDal) {
        addDal(acc, size, bDal + bSabji, ozPerContainer);
        swappedTo = 'dal';
      } else if (dislikesDal && !dislikesSabji) {
        addSabji(acc, size, bDal + bSabji, ozPerContainer);
        swappedTo = 'sabji';
      } else {
        addDal(acc, size, bDal, ozPerContainer);
        addSabji(acc, size, bSabji, ozPerContainer);
      }

      recordDishSwap(acc, swappedTo, exclusion, bDal + bSabji > 0);
      return acc;
    }

    addChicken(acc, size, chickenContainers, ozPerContainer, legsPerContainer);
    addGravy(acc, size, gravyContainers, ozPerContainer);

    // Full non-veg meals pack their single veg-side container at the Veg station;
    // Half non-veg meals pack ONLY the chicken container.
    if (!isHalf) {
      const baseVegDal = baseCounts.dal > 0 && baseCounts.sabji === 0 ? 1 : 0;
      const baseVegSabji = baseVegDal === 1 ? 0 : 1;
      let nvDal = baseVegDal;
      let nvSabji = baseVegSabji;

      if (dislikesSabji && !dislikesDal) {
        nvDal = 1;
        nvSabji = 0;
        if (baseVegSabji > 0) swappedTo = 'dal';
      } else if (dislikesDal && !dislikesSabji) {
        nvDal = 0;
        nvSabji = 1;
        if (baseVegDal > 0) swappedTo = 'sabji';
      }

      recordDishSwap(acc, swappedTo, exclusion, nvDal + nvSabji > 0);
      addDal(acc, size, nvDal, ozPerContainer);
      addSabji(acc, size, nvSabji, ozPerContainer);
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



