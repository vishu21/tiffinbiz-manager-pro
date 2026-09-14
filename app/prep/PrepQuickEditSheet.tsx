'use client';

import React, { useEffect, useState } from 'react';
import type { MealConfigPayload } from '@/app/admin/actions';
import { parseActiveScheduleDays } from '@/app/utils/customerPickup';

// Minimal view of a manifest row — only the fields the quick sheet edits/reads.
type QuickCustomer = {
  id: string;
  full_name: string;
  meal_type?: string | null;
  // Legacy/secondary diet column — read only as a fallback when `meal_type` is absent.
  dietary_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  dietary_notes?: string | null;
  subscription_status?: string | null;
  // Curry-distribution source columns (full customer rows carry these from the prep page):
  // delivery_instructions holds the plain daily side-count text; is_custom_curry +
  // curry_config hold the structured weekly (M/W/F + T/Th) profile the customer editor uses.
  delivery_instructions?: string | null;
  delivery_schedule?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  // Multi-day vacation pause window (written by `setCustomerVacationPause`). While the
  // dashboard's selected date falls inside [pause_start_date, pause_end_date) the drawer
  // shows the "on vacation" banner with a one-tap Cancel + Resume action.
  pause_start_date?: string | null;
  pause_end_date?: string | null;
};

// Canonical portion tokens (mirrors Customers page + Prep manifest).
const PORTION_RG = 'RG';
const PORTION_LG = 'LG';
const PORTION_HALF_RG = 'Half RG';
const PORTION_HALF_LG = 'Half LG';

const normalizePortion = (value: string | null | undefined): string => {
  const v = (value || '').trim().toUpperCase().split(' ').filter(Boolean).join(' ');
  if (v.startsWith('HALF')) {
    return v.includes('LG') || v.includes('LARGE') ? PORTION_HALF_LG : PORTION_HALF_RG;
  }
  if (v === 'LG' || v === 'LARGE') return PORTION_LG;
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG; // legacy 1x 8oz
  return PORTION_RG;
};

const isNonVeg = (value: string | null | undefined): boolean =>
  String(value || '').toLowerCase().includes('non');

// ── Customer → draft hydration (single source of truth) ─────────────────────────
// The drawer must ALWAYS open on the customer's real master values. `meal_type` wins
// when present (never silently falling back to Veg), `portion_size` defaults to LG, and
// Roti defaults to 8 — mirroring the app's standard plan so a NULL column never shows a
// misleading RG / 0.
const DEFAULT_ROTI_COUNT = 8;
const DEFAULT_PRONTHI_COUNT = 0;

// Raw VEG/NON-VEG source: `meal_type` first, then the legacy `dietary_type` fallback.
const resolveDietarySource = (customer: QuickCustomer): string | null | undefined =>
  customer.meal_type || customer.dietary_type;

// Normalized to the app-wide 'Veg' | 'Non-veg' draft token — NON-VEG is preserved.
const resolveDietaryType = (customer: QuickCustomer): 'Veg' | 'Non-veg' =>
  isNonVeg(resolveDietarySource(customer)) ? 'Non-veg' : 'Veg';

// Portion defaults to LG when the column is NULL, then normalizes legacy labels.
const resolvePortion = (customer: QuickCustomer): string =>
  normalizePortion(customer.portion_size || PORTION_LG);

// Notes fall back to the legacy delivery_instructions column so a note stored there is
// never lost when the drawer opens.
const resolveNotes = (customer: QuickCustomer): string =>
  customer.dietary_notes || customer.delivery_instructions || '';

type RiceCounts = { rg: number; lg: number; xl: number };
const ZERO_RICE: RiceCounts = { rg: 0, lg: 0, xl: 0 };

// Preset rice selectors — same vocabulary the rest of the app uses for rice_count.
const RICE_PRESETS: { label: string; counts: RiceCounts }[] = [
  { label: 'None', counts: { rg: 0, lg: 0, xl: 0 } },
  { label: '1 RG', counts: { rg: 1, lg: 0, xl: 0 } },
  { label: '1 LG', counts: { rg: 0, lg: 1, xl: 0 } },
  { label: '1 RG + 1 LG', counts: { rg: 1, lg: 1, xl: 0 } },
  { label: '2 RG', counts: { rg: 2, lg: 0, xl: 0 } },
  { label: '2 LG', counts: { rg: 0, lg: 2, xl: 0 } },
  { label: '1 XL', counts: { rg: 0, lg: 0, xl: 1 } },
];

const parseRiceCounts = (value: string | null | undefined): RiceCounts => {
  const counts: RiceCounts = { ...ZERO_RICE };
  const v = String(value || '').trim();
  if (!v || v === 'None' || v === '—') return counts;
  v.split('+').forEach(token => {
    const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/i);
    if (m) counts[m[2].toLowerCase() as keyof RiceCounts] += parseInt(m[1], 10);
  });
  return counts;
};

const riceEqual = (a: RiceCounts, b: RiceCounts): boolean =>
  a.rg === b.rg && a.lg === b.lg && a.xl === b.xl;

const riceToDb = (c: RiceCounts): string => {
  const parts: string[] = [];
  if (c.rg) parts.push(`${c.rg} rg`);
  if (c.lg) parts.push(`${c.lg} lg`);
  if (c.xl) parts.push(`${c.xl} xl`);
  return parts.length ? parts.join(' + ') : 'None';
};

// ── Curry (side-dish) distribution state ──────────────────────────────────────────────
// The Quick Update drawer edits the customer's daily curry allocation the same way the
// /admin/customers meal editor does. Full tiers are two-container combos (picked with the
// pill row below); Half tiers are a single container whose side is implied by diet type.
// Every change toggling Dietary Type / Portion / a Curry pill is re-synced on save into
// BOTH `delivery_instructions` (plain counts text the prep parsers read) and the structured
// `curry_config` / `is_custom_curry` columns (weekly M/W/F + T/Th profile + custom badges).

const isHalfPortionToken = (token: string): boolean =>
  String(token || '').trim().toUpperCase().startsWith('HALF');

type CurryCounts = { dal: number; sabji: number; chicken: number; gravy: number };
const ZERO_CURRY: CurryCounts = { dal: 0, sabji: 0, chicken: 0, gravy: 0 };

// Official day-group defaults (mirror the customer editor constants):
//   M/W/F (non-veg meal) default → 1 Sabji + 1 Chicken
//   T/Th (veg meal) default      → 1 Dal + 1 Sabji
const DEFAULT_MWF_COUNTS: CurryCounts = { dal: 0, sabji: 1, chicken: 1, gravy: 0 };
const DEFAULT_TTH_COUNTS: CurryCounts = { dal: 1, sabji: 1, chicken: 0, gravy: 0 };

const curryCountsEqual = (a: CurryCounts, b: CurryCounts): boolean =>
  a.dal === b.dal && a.sabji === b.sabji && a.chicken === b.chicken && a.gravy === b.gravy;

const hasAnyCurryCount = (c: CurryCounts): boolean =>
  c.dal > 0 || c.sabji > 0 || c.chicken > 0 || c.gravy > 0;

// Auto-applied defaults when Dietary Type or Portion toggles (mirrors the customer
// editor's applyMealDefaults): full plans → two containers, Half plans → one container.
const defaultCurryCounts = (mealType: 'Veg' | 'Non-veg', portion: string): CurryCounts => {
  if (isHalfPortionToken(portion)) {
    return mealType === 'Non-veg'
      ? { dal: 0, sabji: 0, chicken: 1, gravy: 0 }
      : { dal: 1, sabji: 0, chicken: 0, gravy: 0 };
  }
  return mealType === 'Non-veg'
    ? { dal: 0, sabji: 1, chicken: 1, gravy: 0 }
    : { dal: 1, sabji: 1, chicken: 0, gravy: 0 };
};

// Compact pill presets shown under Portion. Keys/labels mirror the customer editor's
// day-group quick pills (2x Gravy / custom steppers are intentionally not exposed here).
type CurryPill = { key: string; label: string; counts: CurryCounts };
const NON_VEG_CURRY_PILLS: CurryPill[] = [
  { key: 'default', label: '1 Sabji + 1 Chicken (Default)', counts: { dal: 0, sabji: 1, chicken: 1, gravy: 0 } },
  { key: 'dal-chicken', label: '1 Dal + 1 Chicken', counts: { dal: 1, sabji: 0, chicken: 1, gravy: 0 } },
  { key: 'double-chicken', label: '2x Chicken', counts: { dal: 0, sabji: 0, chicken: 2, gravy: 0 } },
];
const VEG_CURRY_PILLS: CurryPill[] = [
  { key: 'default', label: '1 Dal + 1 Sabji (Default)', counts: { dal: 1, sabji: 1, chicken: 0, gravy: 0 } },
  { key: 'double-sabji', label: '2x Sabji', counts: { dal: 0, sabji: 2, chicken: 0, gravy: 0 } },
  { key: 'double-dal', label: '2x Dal', counts: { dal: 2, sabji: 0, chicken: 0, gravy: 0 } },
];
const curryPillsFor = (mealType: 'Veg' | 'Non-veg'): CurryPill[] =>
  mealType === 'Non-veg' ? NON_VEG_CURRY_PILLS : VEG_CURRY_PILLS;

// Guarantees the pill row always has an active (highlighted) pill: when a stored curry
// allocation isn't one of the selectable presets for the customer's diet (stale / legacy
// combo such as a Veg-era distribution on a Non-Veg customer), it snaps to that diet's
// standard default — Non-Veg → 1 Sabji + 1 Chicken; Veg → 1 Dal + 1 Sabji. Half tiers do
// not render the pill row, so their single-container allocation is left untouched.
const snapCurryToPill = (
  candidate: CurryCounts,
  mealType: 'Veg' | 'Non-veg',
  portion: string
): CurryCounts => {
  if (isHalfPortionToken(portion)) return candidate;
  return curryPillsFor(mealType).some(p => curryCountsEqual(p.counts, candidate))
    ? candidate
    : defaultCurryCounts(mealType, portion);
};

// Counts an ingredient out of instruction text: "2x Dal", "2 Dal", "both Dal", or a bare
// mention (1). Same vocabulary the rest of the app uses to read delivery_instructions.
const extractCurryCount = (text: string, keyword: string): number => {
  const lower = text.toLowerCase();
  const xMatch = lower.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}`));
  if (xMatch) return parseInt(xMatch[1], 10);
  const plainMatch = lower.match(new RegExp(`(\\d+)\\s*${keyword}`));
  if (plainMatch) return parseInt(plainMatch[1], 10);
  if (lower.includes(`both ${keyword}`)) return 2;
  return lower.includes(keyword) ? 1 : 0;
};

const parseCurryCounts = (instructions: string | null | undefined): CurryCounts => {
  const text = String(instructions || '').trim();
  if (!text || text === 'None' || text === '—') return { ...ZERO_CURRY };
  return {
    dal: extractCurryCount(text, 'dal'),
    sabji: extractCurryCount(text, 'sabji'),
    chicken: extractCurryCount(text, 'chicken'),
    gravy: extractCurryCount(text, 'gravy'),
  };
};


// Reads a structured `curry_config` JSON value ({ pattern_type, mwf, tth, extras }). Returns
// null for legacy plain-text configs and malformed values (treated like "no profile").
const parseStructuredCurryConfig = (
  raw: string | null | undefined
): { mwf: CurryCounts; tth: CurryCounts; extras: string[] } | null => {
  const trimmed = String(raw || '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      mwf?: Partial<CurryCounts> | null;
      tth?: Partial<CurryCounts> | null;
      extras?: string[] | null;
    };
    if (!parsed || !parsed.mwf || !parsed.tth) return null;
    const norm = (p: Partial<CurryCounts> | null | undefined): CurryCounts => ({
      dal: Number(p?.dal) || 0,
      sabji: Number(p?.sabji) || 0,
      chicken: Number(p?.chicken) || 0,
      gravy: Number(p?.gravy) || 0,
    });
    return {
      mwf: norm(parsed.mwf),
      tth: norm(parsed.tth),
      extras: Array.isArray(parsed.extras) ? parsed.extras : [],
    };
  } catch {
    return null;
  }
};

// The curry allocation a customer currently has on record for their meal type's main days.
// Structured JSON (MWF profile) wins when present; otherwise the plain delivery_instructions
// text is parsed; a record with no side info falls back to the diet/portion standard.
const getStoredCurryCounts = (customer: QuickCustomer): CurryCounts => {
  const storedDiet: 'Veg' | 'Non-veg' = resolveDietaryType(customer);
  const storedPortion = resolvePortion(customer);
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) return structured.mwf;
  const parsed = parseCurryCounts(customer.delivery_instructions);
  if (hasAnyCurryCount(parsed)) return parsed;
  return defaultCurryCounts(storedDiet, storedPortion);
};

// The stored Tue/Thu (veg-day) profile, preserved when a customer converts to Non-Veg so
// their veg-day preference survives a quick dietary-type edit. No stored config means the
// standard T/Th meal (1 Dal + 1 Sabji) is what the customer editor assumes.
const getStoredTthCounts = (customer: QuickCustomer): CurryCounts => {
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) return structured.tth;
  return { ...DEFAULT_TTH_COUNTS };
};

// "Salad" / "2x Salad" style add-on formatting (matches formatSideAddon in the editor).
const formatAddonCount = (count: number, label: string): string =>
  count > 1 ? `${count}x ${label}` : label;

const FRIDAY_DOUBLE_PACK_NOTE = '[NOTE: Pack 2 Tiffins on Friday for Saturday meal]';

// Rebuilds delivery_instructions exactly the way the customer editor does: curry counts
// first, then preserved Salad / Dessert add-on tokens and the Friday double-pack marker.
const buildDeliveryInstructions = (
  counts: CurryCounts,
  addons: { salad: number; dessert: number },
  includeFridayNote: boolean
): string => {
  const parts: string[] = [];
  if (counts.dal > 0) parts.push(`${counts.dal} Dal`);
  if (counts.sabji > 0) parts.push(`${counts.sabji} Sabji`);
  if (counts.gravy > 0) parts.push(`${counts.gravy} Gravy`);
  if (counts.chicken > 0) parts.push(`${counts.chicken} Chicken`);
  let text = parts.length > 0 ? parts.join(' + ') : '1 Dal + 1 Sabji';
  if (addons.salad > 0) text += ` + ${formatAddonCount(addons.salad, 'Salad')}`;
  if (addons.dessert > 0) text += ` + ${formatAddonCount(addons.dessert, 'Dessert')} (weekly)`;
  return includeFridayNote ? `${text} ${FRIDAY_DOUBLE_PACK_NOTE}` : text;
};

// Salad / Dessert add-ons to embed in a custom structured config (same extras vocabulary the
// customer editor writes — never treated as a curry deviation on their own).
const buildCurryExtras = (addons: { salad: number; dessert: number }): string[] => {
  const extras: string[] = [];
  if (addons.salad > 0) extras.push(formatAddonCount(addons.salad, 'Salad'));
  if (addons.dessert > 0) extras.push(formatAddonCount(addons.dessert, 'Dessert'));
  return extras;
};

const serializeWeeklyCurryConfig = (
  mealType: 'Veg' | 'Non-veg',
  counts: CurryCounts,
  preservedTth: CurryCounts,
  extras: string[]
): string => {
  const mwf = { dal: counts.dal, chicken: counts.chicken, sabji: counts.sabji, gravy: counts.gravy || 0 };
  if (mealType === 'Non-veg') {
    return JSON.stringify({
      pattern_type: 'non_veg_rotation',
      mwf,
      tth: {
        dal: preservedTth.dal,
        chicken: preservedTth.chicken,
        sabji: preservedTth.sabji,
        gravy: preservedTth.gravy || 0,
      },
      extras,
    });
  }
  return JSON.stringify({
    pattern_type: 'veg_fixed',
    mwf,
    tth: { ...mwf },
    extras,
  });
};


// ── Multi-day vacation pause helpers ─────────────────────────────────────────────
// The drawer previews how many delivery meals a pause will skip. This mirrors the
// server-side `calculateDeliveryDates` in app/prep/actions.ts exactly: every delivery
// date in the half-open window [start, resume), filtered by the customer's schedule.
const SCHEDULE_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DEFAULT_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Local YYYY-MM-DD key (never UTC-split) for a Date — matches the dashboard's date keys.
const toDateInputKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Parses a local YYYY-MM-DD key into a local-midnight Date (null when invalid).
const parseDateInputKey = (key: string): Date | null => {
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Adds `days` calendar days to a local YYYY-MM-DD key (used to seed a 3-day range).
const addCalendarDays = (key: string, days: number): string => {
  const date = parseDateInputKey(key);
  if (!date) return key;
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return toDateInputKey(next);
};

// Counts the delivery days inside the INCLUSIVE window [start, end] for the customer's
// schedule. Falls back to the Mon–Fri default when no schedule parses, so the range
// preview never reads 0 merely because the column is blank.
const countDeliveryDaysInRange = (
  start: string,
  end: string,
  schedule: string | null | undefined
): number => {
  const startDate = parseDateInputKey(start);
  const endDate = parseDateInputKey(end);
  if (!startDate || !endDate || startDate > endDate) return 0;

  // 'Mon - Fri' / 'Mon–Fri' hyphen ranges → the 'X to Y' form the shared parser expands.
  const normalized = String(schedule || '').replace(
    /\b([A-Za-z]{3,9})\s*[-–—]\s*([A-Za-z]{3,9})\b/g,
    '$1 to $2'
  );
  const parsed = parseActiveScheduleDays(normalized);
  const allowed = new Set(parsed.length > 0 ? parsed : DEFAULT_DELIVERY_DAYS);

  let count = 0;
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    if (allowed.has(SCHEDULE_DAY_NAMES[cursor.getDay()])) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

// The three ways a save can be scoped. "Date Range" applies the same change (a skip OR
// the meal profile) to every delivery day in [startDate, endDate], then reverts to the
// master profile automatically once the window passes.
export type QuickEditScope = 'today' | 'range' | 'permanent';

export type QuickEditSaveRequest = {
  scope: QuickEditScope;
  // Inclusive local YYYY-MM-DD window. "Today Only" sends the same key for both ends.
  startDate: string;
  endDate: string;
  // Draft skip state: true batches `is_skipped` rows + extends the billing cycle; false
  // writes the custom meal profile / notes for the window.
  isSkipped: boolean;
  config: MealConfigPayload;
};

// Footer "APPLY TO" pills — ⚡ single day, 📅 explicit window, 🔄 master profile.
const APPLY_SCOPE_OPTIONS: {
  key: QuickEditScope;
  icon: string;
  label: string;
  sub: string;
  title: string;
}[] = [
  {
    key: 'today',
    icon: '⚡',
    label: 'Today Only',
    sub: 'Single day',
    title: 'Apply to this manifest date only',
  },
  {
    key: 'range',
    icon: '📅',
    label: 'Date Range',
    sub: 'Multi-day',
    title: 'Apply to every delivery day in a date window',
  },
  {
    key: 'permanent',
    icon: '🔄',
    label: 'Permanent Profile',
    sub: 'All future',
    title: 'Update the master profile for all future deliveries',
  },
];

type Props = {
  customer: QuickCustomer;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (request: QuickEditSaveRequest) => void;
  // Manifest's active calendar date (local YYYY-MM-DD + human label) — the scope
  // a "Today Only" save is applied to.
  overrideDate: string;
  overrideDateLabel: string;
  // True when this customer already has a "Today Only" override for the date.
  isOverrideActive?: boolean;
  // True when the selected date is CURRENTLY skipped for this customer (a date-scoped
  // override row with is_skipped === true). Seeds the drawer's skip draft.
  isSkipped?: boolean;
  // True when ANY date-scoped override row exists for this customer + date (a "Today
  // Only" meal snapshot OR a skip flag). Reveals the "Reset to Master Profile" control.
  hasDayOverride?: boolean;
  // Discards every daily change for this date (deletes the override row) and reloads
  // the master customer profile.
  onClearOverride?: () => void;
  // ── Legacy vacation pause banner ─────────────────────────────────────────────
  // Cancels an existing (legacy) vacation pause: restores every skipped day and rolls
  // the billing cycle back by the same count.
  onCancelVacationPause?: () => void;
  // A vacation pause cancel write is in flight.
  vacationPending?: boolean;
};

export default function PrepQuickEditSheet({
  customer,
  saving,
  error,
  onClose,
  onSave,
  overrideDate,
  overrideDateLabel,
  isOverrideActive = false,
  isSkipped = false,
  hasDayOverride = false,
  onClearOverride,
  onCancelVacationPause,
  vacationPending = false,
}: Props) {
  const [visible, setVisible] = useState(false);

  // Save scope: "Today Only" (default) writes a single date-scoped override row;
  // "Date Range" applies the same change to every delivery day in [rangeStart, rangeEnd];
  // "Permanent Profile" two-way syncs the master customer profile.
  const [scope, setScope] = useState<QuickEditScope>('today');

  // Skip is a DRAFT flag committed by the single footer Save button: toggling it only marks
  // intent — the footer scope (Today / Date Range / Permanent) decides which days it lands
  // on. Seeded from the day's persisted skip state.
  const [draftSkipped, setDraftSkipped] = useState<boolean>(isSkipped);
  // Inclusive date-range window. The start defaults to the manifest's selected date and the
  // end to a 3-day window so the range option is immediately meaningful.
  const [rangeStart, setRangeStart] = useState<string>(overrideDate);
  const [rangeEnd, setRangeEnd] = useState<string>(() => addCalendarDays(overrideDate, 2));
  // Local (client-side) validation message for the range inputs.
  const [formError, setFormError] = useState<string | null>(null);

  // Draft form state — seeded from the customer on mount. The sheet is REMOUNTED (keyed
  // by customer.id + a reset token) whenever another row, or a "Reset to Master Profile",
  // needs the draft re-hydrated from the incoming customer row.
  const [mealType, setMealType] = useState<'Veg' | 'Non-veg'>(() =>
    resolveDietaryType(customer)
  );
  const [portion, setPortion] = useState<string>(() => resolvePortion(customer));
  // Curry distribution state — seeded from the customer's stored daily curry profile so the
  // pill row highlights what the kitchen actually packs today. When the stored allocation
  // isn't one of the selectable pills for that diet, snap it to the diet's standard default
  // so exactly one pill (the default) is always highlighted on open.
  const [curry, setCurry] = useState<CurryCounts>(() => {
    const diet: 'Veg' | 'Non-veg' = resolveDietaryType(customer);
    const stored = getStoredCurryCounts(customer);
    return snapCurryToPill(stored, diet, resolvePortion(customer));
  });
  const [roti, setRoti] = useState<number>(() => customer.roti_count ?? DEFAULT_ROTI_COUNT);
  const [pronthi, setPronthi] = useState<number>(
    () => customer.pronthi_count ?? DEFAULT_PRONTHI_COUNT
  );
  const [rice, setRice] = useState<RiceCounts>(() => parseRiceCounts(customer.rice_count));
  const [notes, setNotes] = useState<string>(() => resolveNotes(customer));

  // Slide/sheet in on mount — one frame later so the CSS transition animates.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const currentDiet: 'Veg' | 'Non-veg' = resolveDietaryType(customer);
  const currentPortion = resolvePortion(customer);
  const currentRoti = customer.roti_count ?? DEFAULT_ROTI_COUNT;
  const currentPronthi = customer.pronthi_count ?? DEFAULT_PRONTHI_COUNT;
  const currentRiceDb = riceToDb(parseRiceCounts(customer.rice_count));
  const currentNotes = resolveNotes(customer).trim();
  const storedCurryCounts = getStoredCurryCounts(customer);
  const isHalfTier = isHalfPortionToken(portion);
  const isNonVegDraft = mealType === 'Non-veg';

  // Skip draft + range preview. `rangeDays` mirrors the server's delivery-day resolution
  // (weekend / off-schedule days are never counted).
  const skipActive = draftSkipped;
  const rangeInvalid = !rangeStart || !rangeEnd || rangeStart > rangeEnd;
  const rangeDays = rangeInvalid
    ? 0
    : countDeliveryDaysInRange(rangeStart, rangeEnd, customer.delivery_schedule);

  // Switching scope clears any stale validation message; a "Permanent Profile" save
  // rewrites the master record, so a skip draft has no meaning there.
  const handleScopeChange = (next: QuickEditScope) => {
    setScope(next);
    setFormError(null);
    if (next === 'permanent') setDraftSkipped(false);
  };

  // Toggling Dietary Type ALWAYS snaps the curry distribution back to the standard profile
  // for the selected diet + portion (Non-Veg → 1 Sabji + 1 Chicken; Veg → 1 Dal + 1 Sabji).
  // A stale Veg-era "1 Dal + 1 Sabji" is never retained on a Non-Veg customer.
  const handleMealTypeChange = (next: 'Veg' | 'Non-veg') => {
    if (next === mealType) return;
    setMealType(next);
    setCurry(defaultCurryCounts(next, portion));
  };

  // Portion tier changes also reset the curry to that tier's standard (full = 2 containers,
  // Half = 1 container) — mirrors the customer editor's handlePortionChange behavior.
  const handlePortionChange = (next: string) => {
    if (next === portion) return;
    setPortion(next);
    setCurry(defaultCurryCounts(mealType, next));
  };

  const handleCurryPillChange = (counts: CurryCounts) => setCurry(counts);

  const handleSave = () => {
    // Only changed fields are sent on the permanent path — the server action
    // updates those master-profile columns only. The "Today Only" path needs a
    // FULL snapshot of every editable field so the date-scoped override row is
    // self-contained for the manifest/metric reducer.
    const diffConfig: MealConfigPayload = {};

    const dietChanged = currentDiet !== mealType;
    const portionChanged = currentPortion !== portion;
    const curryChanged = !curryCountsEqual(curry, storedCurryCounts);
    const curryAffected = dietChanged || portionChanged || curryChanged;

    if (dietChanged) diffConfig.meal_type = mealType;
    if (portionChanged) diffConfig.portion_size = portion;
    const rotiChanged = currentRoti !== roti;
    if (rotiChanged) diffConfig.roti_count = roti;
    const pronthiChanged = currentPronthi !== pronthi;
    if (pronthiChanged) diffConfig.pronthi_count = pronthi;

    const nextRiceDb = riceToDb(rice);
    const riceChanged = currentRiceDb !== nextRiceDb;
    if (riceChanged) diffConfig.rice_count = nextRiceDb;

    const nextNotes = notes.trim();
    const notesChanged = currentNotes !== nextNotes;
    if (notesChanged) diffConfig.dietary_notes = nextNotes || null;

    // When Dietary Type, Portion tier, or the curry pill changed, re-sync the
    // customer's curry distribution across delivery_instructions + the structured
    // curry_config so the /admin/customers profile, prep manifest badges, and prep
    // metrics all stay in agreement.
    const buildCurrySync = (): MealConfigPayload => {
      const storedInstructions = (customer.delivery_instructions || '').trim();
      const addons = {
        salad: extractCurryCount(storedInstructions, 'salad'),
        dessert: extractCurryCount(storedInstructions, 'dessert'),
      };
      const includeFridayNote =
        storedInstructions.includes(FRIDAY_DOUBLE_PACK_NOTE) ||
        String(customer.delivery_schedule || '').toLowerCase().includes('sat');

      const sync: MealConfigPayload = {
        delivery_instructions: buildDeliveryInstructions(curry, addons, includeFridayNote),
      };

      if (isHalfTier) {
        // Half plans are single-container by design — no structured custom-curry profile.
        sync.is_custom_curry = false;
        sync.curry_config = null;
      } else if (isNonVegDraft) {
        const mwf = curry;
        const tth = getStoredTthCounts(customer);
        const isCustom =
          !curryCountsEqual(mwf, DEFAULT_MWF_COUNTS) ||
          !curryCountsEqual(tth, DEFAULT_TTH_COUNTS);
        sync.is_custom_curry = isCustom;
        sync.curry_config = isCustom
          ? serializeWeeklyCurryConfig(mealType, curry, tth, buildCurryExtras(addons))
          : null;
      } else {
        const standard = defaultCurryCounts('Veg', portion);
        const isCustom = !curryCountsEqual(curry, standard);
        sync.is_custom_curry = isCustom;
        sync.curry_config = isCustom
          ? serializeWeeklyCurryConfig(mealType, curry, getStoredTthCounts(customer), buildCurryExtras(addons))
          : null;
      }
      return sync;
    };

    if (curryAffected) Object.assign(diffConfig, buildCurrySync());

    // Full snapshot for the "Today Only" scope — every editable field. Untouched fields
    // copy the resolved customer value (which may be NULL) VERBATIM rather than the draft
    // default, so a day snapshot only records REAL deviations and never stamps a bogus
    // "Roti 8" / "LG portion" / "Updated notes" tag onto the manifest.
    const snapshot: MealConfigPayload = {
      meal_type: mealType,
      portion_size: portionChanged ? portion : customer.portion_size ?? undefined,
      roti_count: rotiChanged ? roti : customer.roti_count ?? undefined,
      pronthi_count: pronthiChanged ? pronthi : customer.pronthi_count ?? undefined,
      rice_count: riceChanged ? nextRiceDb : (customer.rice_count || 'None'),
      dietary_notes: notesChanged ? nextNotes || null : customer.dietary_notes ?? null,
    };
    if (curryAffected) {
      Object.assign(snapshot, buildCurrySync());
    } else {
      snapshot.delivery_instructions = customer.delivery_instructions ?? null;
      snapshot.is_custom_curry = customer.is_custom_curry ?? null;
      snapshot.curry_config = customer.curry_config ?? null;
    }

    const hasDiff = Object.keys(diffConfig).length > 0;

    // A range save is valid only when the window is well-formed and lands on at least one
    // delivery day; otherwise surface an inline message instead of a silent no-op write.
    if (scope === 'range') {
      if (rangeInvalid) {
        setFormError('Pick an end date on or after the start date.');
        return;
      }
      if (rangeDays === 0) {
        setFormError('No delivery days fall inside this window.');
        return;
      }
    }

    // The skip is a DRAFT flag committed here, so a toggled skip is a real change even when
    // no meal field moved.
    const skipChanged = draftSkipped !== isSkipped;
    const hasWork = hasDiff || skipChanged;

    if (scope !== 'permanent' && !hasWork) {
      // Nothing changed → never stamp a redundant window of overrides.
      onClose();
      return;
    }
    if (scope === 'permanent' && !hasDiff && !isOverrideActive) {
      // Nothing changed and no day override to clear/promote.
      onClose();
      return;
    }

    // Permanent scope with an active day override but no manual edit = promote
    // the day's override into the master profile (the parent then clears the
    // single-day tag). Every other permanent save ships only the changed fields.
    const permanentConfig = hasDiff || !isOverrideActive ? diffConfig : snapshot;
    const applyToday = scope === 'today';

    setFormError(null);
    onSave({
      scope,
      // "Today Only" sends the selected date as both ends of the window.
      startDate: applyToday ? overrideDate : rangeStart,
      endDate: applyToday ? overrideDate : rangeEnd,
      isSkipped: scope === 'permanent' ? false : draftSkipped,
      config: applyToday ? snapshot : scope === 'range' ? snapshot : permanentConfig,
    });
  };

  // Concise portion badge token — the badge span's `uppercase` class handles display, so it
  // renders RG / LG / HALF RG / HALF LG instead of the verbose "REGULAR" / "LARGE".
  const portionLabel = (() => {
    if (portion === PORTION_LG) return 'LG';
    if (portion === PORTION_HALF_LG) return 'HALF LG';
    if (portion === PORTION_HALF_RG) return 'HALF RG';
    return 'RG';
  })();

  const halfCurryHint = isNonVegDraft ? '1 Chicken' : '1 Dal';

  // ── Vacation pause banner state ────────────────────────────────────────────
  // The customer is "on vacation" while the selected date sits inside the recorded
  // window [pause_start_date, pause_end_date); an open-ended pause (no end date) stays
  // active from the start date on.
  const pauseStart = customer.pause_start_date ?? null;
  const pauseEnd = customer.pause_end_date ?? null;
  const isOnVacation =
    Boolean(pauseStart) && overrideDate >= (pauseStart as string) && (!pauseEnd || overrideDate < pauseEnd);

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-[#11142D]/45 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel: bottom sheet on mobile, right slide-over on sm+ */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit meal config for ${customer.full_name}`}
        className={`absolute inset-x-0 bottom-0 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:left-auto w-full sm:w-[440px] sm:max-w-[92vw] max-h-[88vh] sm:max-h-none flex flex-col bg-white rounded-t-3xl sm:rounded-t-none sm:rounded-l-2xl shadow-2xl transition-transform duration-300 ease-out will-change-transform ${
          visible
            ? 'translate-y-0 sm:translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-y-0 sm:translate-x-full'
        }`}
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-3 border-b border-[#F0F0F2] shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-black text-[#11142D] truncate">{customer.full_name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-black tracking-wide uppercase border ${
                  mealType === 'Non-veg'
                    ? 'bg-rose-50 text-rose-600 border-rose-100'
                    : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                }`}
              >
                {mealType === 'Non-veg' ? 'Non-Veg' : 'Veg'}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-black tracking-wide uppercase bg-indigo-50 text-indigo-600 border border-indigo-100">
                {portionLabel}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-black tracking-wide uppercase bg-gray-100 text-gray-600 border border-gray-100">
                {(customer.subscription_status || 'active') === 'active'
                  ? 'Active'
                  : customer.subscription_status}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick edit"
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors text-2xl leading-none font-bold"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5 text-[#292D32] overscroll-contain">
          {(error || formError) && (
            <div className="px-3.5 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 text-[13px] font-semibold rounded-lg flex items-start gap-2">
              <span aria-hidden="true">⚠️</span>
              <span>{error || formError}</span>
            </div>
          )}

          {/* ── Skip / Vacation Banner ─────────────────────────────────────────
              Sits at the very top of the drawer, above Dietary Type:
                • An active (legacy) vacation pause → 🏖️ window banner + one-tap Cancel.
                • Otherwise → a single skip toggle that DRAFTS the skip. The footer's
                  APPLY TO scope (Today Only / Date Range / Permanent Profile) decides
                  which delivery days it lands on when Save is pressed.
              Every control is `type="button"` on purpose: they must never submit a form. */}
          {isOnVacation && (
            <div className="bg-sky-50 border border-sky-200 text-sky-900 rounded-lg p-3 mb-4">
              <p className="text-[13px] font-bold">
                🏖️ Customer on Vacation ({pauseStart} to {pauseEnd || 'Indefinite'})
              </p>
              <p className="text-[12px] font-semibold mt-0.5">
                Every delivery meal in this window is skipped; the billing cycle was
                extended by the same number of days.
              </p>
              <button
                type="button"
                onClick={() => onCancelVacationPause?.()}
                disabled={vacationPending || saving}
                className="mt-3 w-full h-10 bg-white border border-sky-300 text-sky-900 font-bold rounded-lg hover:bg-sky-100 transition-colors text-[13px] disabled:opacity-60 disabled:cursor-wait"
              >
                ↩️ Cancel Vacation &amp; Resume Meals
              </button>
            </div>
          )}

          {/* Single skip action — toggles the DRAFT flag the footer Save commits. The
              footer's APPLY TO scope decides which delivery days it lands on. */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setDraftSkipped(prev => !prev);
                setFormError(null);
              }}
              disabled={saving || scope === 'permanent'}
              className={`w-full h-11 rounded-xl font-bold transition-colors text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                skipActive
                  ? 'bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200'
                  : 'bg-white border border-gray-300 text-[#292D32] hover:bg-gray-50'
              }`}
            >
              {skipActive ? '↩️ Undo Skip' : '⏸️ Skip Delivery'}
            </button>
            <p className="mt-1.5 text-[11px] text-gray-400 font-medium text-center">
              {scope === 'permanent'
                ? 'Skips need a Today Only or Date Range scope.'
                : skipActive
                  ? 'Skips the delivery days chosen below & extends the billing cycle.'
                  : 'Marks the delivery days chosen below as skipped.'}
            </p>
          </div>

          {/* Meal customization form — collapsed while the skip draft is active (the footer
              scope + Save stay reachable so the skip can still be scoped to a range). */}
          <div
            inert={skipActive}
            aria-hidden={skipActive || undefined}
            className={`space-y-5 overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
              skipActive ? 'max-h-0 opacity-0' : 'max-h-[1600px] opacity-100'
            }`}
          >
          {/* Dietary Type */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Dietary Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  key: 'Veg' as const,
                  label: 'Veg',
                  active: 'bg-emerald-600 text-white border-emerald-600 font-bold',
                  inactive: 'bg-white text-gray-600 border-gray-200',
                },
                {
                  key: 'Non-veg' as const,
                  label: 'Non-Veg',
                  active: 'bg-rose-600 text-white border-rose-600 font-bold',
                  inactive: 'bg-white text-gray-600 border-gray-200',
                },
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleMealTypeChange(opt.key)}
                  className={`h-11 rounded-xl border text-base transition-colors ${
                    mealType === opt.key ? opt.active : opt.inactive
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Portion */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Portion
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'RG', value: PORTION_RG },
                { label: 'LG', value: PORTION_LG },
                { label: 'HALF RG', value: PORTION_HALF_RG },
                { label: 'HALF LG', value: PORTION_HALF_LG },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handlePortionChange(opt.value)}
                  className={`h-11 rounded-xl border text-base transition-colors ${
                    portion === opt.value
                      ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] font-bold shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 font-semibold'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Curry selector — compact pill row for the daily curry allocation (full tiers).
              Half plans pack a single container, so they show a static hint instead. */}
          {isHalfTier ? (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Curry
              </label>
              <div className="h-11 px-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 flex items-center text-sm font-semibold text-gray-500">
                Half plan — 1 container/day, auto-set to {halfCurryHint}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Curry
              </label>
              <div className="flex flex-wrap gap-2">
                {curryPillsFor(mealType).map(preset => {
                  const active = curryCountsEqual(curry, preset.counts);
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => handleCurryPillChange(preset.counts)}
                      className={`h-9 px-3 rounded-xl border text-[13px] font-bold transition-colors ${
                        active
                          ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-sm'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Roti stepper */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Roti
            </label>
            <div className="flex items-stretch h-11 w-full rounded-xl overflow-hidden border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setRoti(prev => Math.max(0, prev - 1))}
                aria-label="Decrease roti count"
                className="w-12 h-full bg-gray-100 text-gray-700 font-bold text-2xl flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors shrink-0"
              >
                −
              </button>
              <div className="flex-1 h-full flex items-center justify-center text-base font-black text-[#11142D]">
                {roti}
              </div>
              <button
                type="button"
                onClick={() => setRoti(prev => prev + 1)}
                aria-label="Increase roti count"
                className="w-12 h-full bg-gray-100 text-gray-700 font-bold text-2xl flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors shrink-0"
              >
                +
              </button>
            </div>
          </div>

          {/* Pronthi stepper */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Pronthi
            </label>
            <div className="flex items-stretch h-11 w-full rounded-xl overflow-hidden border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setPronthi(prev => Math.max(0, prev - 1))}
                aria-label="Decrease pronthi count"
                className="w-12 h-full bg-gray-100 text-gray-700 font-bold text-2xl flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors shrink-0"
              >
                −
              </button>
              <div className="flex-1 h-full flex items-center justify-center text-base font-black text-[#11142D]">
                {pronthi}
              </div>
              <button
                type="button"
                onClick={() => setPronthi(prev => prev + 1)}
                aria-label="Increase pronthi count"
                className="w-12 h-full bg-gray-100 text-gray-700 font-bold text-2xl flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors shrink-0"
              >
                +
              </button>
            </div>
          </div>

          {/* Rice selector */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Rice
            </label>
            <div className="flex flex-wrap gap-2">
              {RICE_PRESETS.map(preset => {
                const active = riceEqual(rice, preset.counts);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setRice({ ...preset.counts })}
                    className={`h-11 px-4 rounded-xl border text-sm font-bold transition-colors ${
                      active
                        ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Instructions / Notes */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Side Instructions / Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. No onions, less spicy, extra napkins..."
              rows={3}
              className="w-full text-base px-3 py-2.5 border border-gray-200 rounded-xl outline-none resize-none focus:border-[#5D5FEF] bg-gray-50/60 focus:bg-white text-gray-700 leading-relaxed transition-colors"
            />
          </div>
          </div>

        </div>

        {/* Footer: APPLY TO scope selector + Save. Always visible — even a skip needs the
            scope selector to decide which delivery days it lands on. */}
        <div className="px-5 py-4 shrink-0 bg-white space-y-3 border-t border-[#F0F0F2] overflow-y-auto max-h-[62vh]">
          {/* Reset to Master Profile — one-click discard of every daily change for this
              date (deletes the override row, rolls back a skip's cycle extension). Only
              offered when the date actually carries an override row. */}
          {hasDayOverride && onClearOverride && (
            <button
              type="button"
              onClick={onClearOverride}
              disabled={saving}
              className="w-full h-11 bg-white border border-rose-200 text-rose-600 font-bold rounded-xl hover:bg-rose-50 active:bg-rose-100 transition-colors text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              🗑️ Reset to Master Profile
            </button>
          )}

          {/* APPLY TO — three clean scopes: Today Only / Date Range / Permanent Profile.
              A skip draft and a meal change share this single selector + Save button. */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Apply to
            </label>
            <div className="grid grid-cols-3 gap-2">
              {APPLY_SCOPE_OPTIONS.map(option => {
                const active = scope === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleScopeChange(option.key)}
                    aria-pressed={active}
                    title={
                      option.key === 'today'
                        ? `Apply to ${overrideDateLabel} only`
                        : option.title
                    }
                    className={`min-h-[64px] px-2 py-2 rounded-xl border text-[12px] font-bold transition-colors flex flex-col items-center justify-center gap-1 text-center ${
                      active
                        ? 'bg-[#5D5FEF]/10 text-[#5D5FEF] border-[#5D5FEF]/60 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      {option.icon}
                    </span>
                    <span className="leading-tight">
                      {option.label}
                      <span className="block text-[10px] font-semibold opacity-70 normal-case tracking-normal">
                        {option.key === 'today' ? overrideDateLabel : option.sub}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Inline range window — only when the Date Range scope is active. */}
            {scope === 'range' && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={e => {
                        setRangeStart(e.target.value);
                        setFormError(null);
                      }}
                      className="w-full h-10 px-2 text-[13px] font-semibold bg-white border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={e => {
                        setRangeEnd(e.target.value);
                        setFormError(null);
                      }}
                      className="w-full h-10 px-2 text-[13px] font-semibold bg-white border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-700"
                    />
                  </div>
                </div>

                <p
                  className={`text-[12px] font-semibold rounded-lg px-3 py-2 border ${
                    rangeInvalid || rangeDays === 0
                      ? 'text-rose-600 bg-rose-50 border-rose-200'
                      : 'text-[#5D5FEF] bg-[#5D5FEF]/5 border border-[#5D5FEF]/20'
                  }`}
                >
                  {rangeInvalid
                    ? '⚠️ Pick an end date on or after the start date.'
                    : `ℹ️ Applies to ${rangeDays} delivery ${
                        rangeDays === 1 ? 'day' : 'days'
                      }, then reverts automatically.`}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (scope === 'range' && (rangeInvalid || rangeDays === 0))}
            className="w-full h-12 bg-[#5D5FEF] hover:bg-[#4d4fd9] text-white font-bold rounded-xl shadow-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-base flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : scope === 'permanent' ? (
              'Save Master Profile'
            ) : skipActive ? (
              'Save Skip'
            ) : (
              'Save Meal Config'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
