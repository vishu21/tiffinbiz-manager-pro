'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef, useTransition } from 'react';
import {
  fetchDailyMenu,
  saveDailyMenu,
  getAvailableRecipes,
  getDailyMenuSelection,
  setDailyMenuSelection,
  getDailyOverrides,
  clearDailyOverride,
  toggleDailySkip,
  cancelVacationPause,
  saveCustomerOverride,
  checkDailyOverrideTable,
  reloadSchemaCache,
} from './actions';
import type { Recipe, DailyOverrideRow } from './actions';
import {
  getRecipesWithIngredients,
  type RecipeWithIngredients,
} from '@/app/admin/recipes/actions';
import { useRouter } from 'next/navigation';
import type { MealConfigPayload } from '@/app/admin/actions';
import PrepQuickEditSheet, { type QuickEditSaveRequest } from './PrepQuickEditSheet';
import { isPickupOnDay } from '@/app/utils/customerPickup';
import { computePrepMetrics, resolveSideAddons } from './prepCalculations';

type Customer = {
  id: string;
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  notes?: string | null;
  side_notes?: string | null;
  custom_instructions?: string | null;
  meal_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  delivery_schedule?: string | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  subscription_status?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  scheduled_cancel_date?: string | null;
  scheduled_status?: 'cancelled' | 'paused' | null;
  start_date?: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  isSkipped?: boolean;
  created_at: string;
};

const EMPTY_OVERRIDES: Record<string, DailyOverrideRow> = {};

const formatOverrideUnavailableWarning = (detail?: string): string => {
  const base =
    'Daily override persistence is unavailable — the customer_daily_overrides table was not found (or the schema cache is stale). ' +
    '"Today Only" changes are kept locally for this session only. Apply ' +
    'supabase/migrations/00016_notify_pgrst_reload.sql, then click "Reload schema & retry".';
  return detail && detail.trim() !== '' ? `${base} Server says: ${detail.trim()}` : base;
};

const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

const toLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatShortDate = (dateKey: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const daysBetweenKeys = (from: string, to: string): number => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return Number.NaN;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
};

const isScheduledOn = (
  customer: Pick<
    Customer,
    'delivery_schedule' | 'subscription_status' | 'scheduled_cancel_date' | 'start_date'
  >,
  activeDay: string,
  dateKey: string,
): boolean => {
  const schedule = customer.delivery_schedule || '';
  if (!schedule || schedule === '—') return false;

  const subStatus = (customer.subscription_status || 'active').toLowerCase();
  if (subStatus !== 'active') return false;

  const scheduledDate = customer.scheduled_cancel_date;
  if (scheduledDate && dateKey > scheduledDate) return false;

  const startDate = customer.start_date;
  if (startDate && dateKey < startDate) return false;

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
};

const MAX_DELIVERY_LOOKAHEAD_DAYS = 14;

const resolveNextActiveDeliveryDate = (customers: Customer[]): Date => {
  const anchor = new Date();
  anchor.setHours(12, 0, 0, 0);
  for (let offset = 1; offset <= MAX_DELIVERY_LOOKAHEAD_DAYS; offset++) {
    const candidate = new Date(anchor);
    candidate.setDate(anchor.getDate() + offset);
    const dayName = DAYS_OF_WEEK[(candidate.getDay() + 6) % 7];
    const dateKey = toLocalDateKey(candidate);
    if (customers.some(customer => isScheduledOn(customer, dayName, dateKey))) {
      return candidate;
    }
  }
  const fallback = new Date(anchor);
  fallback.setDate(anchor.getDate() + 1);
  return fallback;
};

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

const formatPortionLabel = (value: string | null | undefined): string =>
  normalizePortionToken(value);

const getPortionContainerSpec = (portionSize: string | null | undefined): string => {
  const p = normalizePortionToken(portionSize);
  if (p === PORTION_LG) return '2x 12oz';
  if (p === PORTION_HALF_LG) return '1x 12oz';
  if (p === PORTION_HALF_RG) return '1x 8oz';
  return '2x 8oz';
};

const hasRiceToPack = (value: string | null | undefined): boolean => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'none' || text === '—' || text === '0') return false;
  return text.split('+').some(token => {
    const m = token.trim().match(/^(\d+)\s*(?:rg|lg|xl)$/);
    return m !== null && parseInt(m[1], 10) > 0;
  });
};

const ADDRESS_REGION_CODES = new Set([
  'ON', 'BC', 'AB', 'SK', 'MB', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU',
  'NY', 'WA', 'MI', 'OH', 'CA', 'TX', 'FL',
]);

const ADDRESS_COUNTRIES = new Set([
  'canada', 'usa', 'us', 'u.s.a.', 'united states', 'united states of america',
  'uk', 'united kingdom', 'india',
]);

const STREET_SUFFIX_ABBR: Record<string, string> = {
  avenue: 'Ave', ave: 'Ave',
  street: 'St', str: 'St',
  road: 'Rd',
  drive: 'Dr',
  boulevard: 'Blvd', blvd: 'Blvd',
  crescent: 'Cres', cres: 'Cres',
  court: 'Crt', crt: 'Crt',
  lane: 'Ln',
  place: 'Pl',
  terrace: 'Terr', terr: 'Terr',
  circle: 'Cir', cir: 'Cir',
  square: 'Sq',
  parkway: 'Pkwy',
  highway: 'Hwy',
  trail: 'Trl',
  close: 'Cl',
  gardens: 'Gdns',
  grove: 'Grv',
  heights: 'Hts',
  manor: 'Mnr',
  mews: 'Mws',
  ridge: 'Rdg',
  view: 'Vw',
};

const shortenStreetSuffixes = (line: string): string =>
  line
    .split(/\s+/)
    .map(word => {
      const key = word.toLowerCase().replace(/[^a-z]/g, '');
      return STREET_SUFFIX_ABBR[key] ?? word;
    })
    .join(' ');

const formatShortAddress = (address: string): string => {
  const raw = String(address || '').trim();
  if (!raw) return '';

  const withoutPostal = raw
    .replace(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/g, ' ')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();

  const segments = withoutPostal
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  while (segments.length > 1) {
    const last = segments[segments.length - 1];
    const isRegion = ADDRESS_REGION_CODES.has(last.toUpperCase());
    const isCountry = ADDRESS_COUNTRIES.has(last.toLowerCase());
    const hasNumber = /\d/.test(last);
    const isUnitLike = /\b(unit|apt|suite|ste|#)\b/i.test(last);
    if (isRegion || isCountry || (!hasNumber && !isUnitLike)) {
      segments.pop();
      continue;
    }
    break;
  }

  const kept = segments.length > 0 ? segments.join(', ') : withoutPostal;
  return shortenStreetSuffixes(kept).replace(/\s{2,}/g, ' ').trim();
};

const formatSizeBadge = (portionSize: string | null | undefined): string => {
  const p = normalizePortionToken(portionSize);
  if (p === PORTION_HALF_LG) return 'HL';
  if (p === PORTION_HALF_RG) return 'HR';
  if (p === PORTION_LG) return 'L';
  return 'R';
};

const formatTypeBadge = (mealType: string | null | undefined): 'V' | 'NV' =>
  String(mealType || '').toLowerCase().includes('non') ? 'NV' : 'V';

const formatBatchBreakdownLines = (
  rows: Array<{ name: string; totalOz: number }>,
): string[] =>
  rows.length === 0
    ? ['No ingredient standards defined.']
    : rows.map(row => {
        const hint = getIngredientCountHint(row.name, row.totalOz);
        // Shorten "Tomatoes (Pureed)" -> "Tomatoes", "Onions (Chopped)" -> "Onions" for print scannability
        const cleanName = row.name.replace(/\s*\([^)]*\)/g, '').trim();
        const hintText = hint ? ` (${hint})` : '';
        return `${cleanName}: ${Math.round(row.totalOz)} oz${hintText}`;
      });

const formatShortRice = (riceCount: string | null | undefined): string => {
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

const kitchenDietRank = (mealType: string | null | undefined): number => {
  const t = String(mealType || '').toLowerCase();
  if (t.includes('non')) return 1;
  if (t.includes('veg')) return 2;
  return 3;
};

const kitchenSizeRank = (portionSize: string | null | undefined): number => {
  const p = normalizePortionToken(portionSize);
  if (p === PORTION_LG) return 1;
  if (p === PORTION_HALF_LG) return 2;
  if (p === PORTION_RG) return 3;
  if (p === PORTION_HALF_RG) return 4;
  return 5;
};

const kitchenOrderSort = (a: Customer, b: Customer): number => {
  const dietDiff = kitchenDietRank(a.meal_type) - kitchenDietRank(b.meal_type);
  if (dietDiff !== 0) return dietDiff;
  const sizeDiff = kitchenSizeRank(a.portion_size) - kitchenSizeRank(b.portion_size);
  if (sizeDiff !== 0) return sizeDiff;
  return (a.full_name || '').localeCompare(b.full_name || '');
};

type CurryProfile = { dal: number; sabji: number; chicken: number; gravy: number };

const DEFAULT_MWF_PROFILE: CurryProfile = { dal: 0, sabji: 1, chicken: 1, gravy: 0 };
const DEFAULT_TTH_PROFILE: CurryProfile = { dal: 1, sabji: 1, chicken: 0, gravy: 0 };

const normalizeCurryProfile = (p: Partial<CurryProfile> | null | undefined): CurryProfile => ({
  dal: p?.dal || 0,
  sabji: p?.sabji || 0,
  chicken: p?.chicken || 0,
  gravy: p?.gravy || 0,
});

const curryProfilesEqual = (a: CurryProfile, b: CurryProfile): boolean =>
  a.dal === b.dal && a.sabji === b.sabji && a.chicken === b.chicken && a.gravy === b.gravy;

const formatCurryProfileText = (p: CurryProfile): string => {
  const parts: string[] = [];
  if (p.dal > 0) parts.push(p.dal > 1 ? `${p.dal} Dal` : '1 Dal');
  if (p.sabji > 0) parts.push(p.sabji > 1 ? `${p.sabji} Sabji` : '1 Sabji');
  if (p.chicken > 0) parts.push(p.chicken > 1 ? `${p.chicken} Chicken` : '1 Chicken');
  if (p.gravy > 0) parts.push(p.gravy > 1 ? `${p.gravy} Gravy` : '1 Gravy');
  return parts.join(' + ');
};

const describeCurrySubstitution = (p: CurryProfile): string => {
  const entries: Array<[number, string]> = [
    [p.dal, 'Dal'],
    [p.sabji, 'Sabji'],
    [p.chicken, 'Chicken'],
    [p.gravy, 'Gravy'],
  ];
  const active = entries.filter(([count]) => count > 0);
  if (active.length === 1 && active[0][0] === 2) return `2x ${active[0][1]}`;
  return formatCurryProfileText(p);
};

const formatCustomCurryRule = (
  mwf: CurryProfile,
  tth: CurryProfile,
  patternType: string | null | undefined
): string | null => {
  if (patternType === 'veg_fixed') {
    return formatCurryProfileText(mwf) || null;
  }
  const deviations: string[] = [];
  if (!curryProfilesEqual(mwf, DEFAULT_MWF_PROFILE)) {
    deviations.push(`M/W/F: ${describeCurrySubstitution(mwf)}`);
  }
  if (!curryProfilesEqual(tth, DEFAULT_TTH_PROFILE)) {
    deviations.push(`T/Th: ${describeCurrySubstitution(tth)}`);
  }
  if (deviations.length === 0) return null;
  return deviations.join(' | ');
};

const getCustomInstructionsText = (
  customer: Pick<Customer, 'is_custom_curry' | 'curry_config'>
): string | null => {
  if (customer.is_custom_curry !== true) return null;
  const raw = (customer.curry_config || '').trim();
  if (!raw) return null;

  const cleanStandardAddons = (str: string) =>
    str
      .replace(/\s*\+\s*(?<!No\s+)Salad\b/gi, '')
      .replace(/\s*\+\s*(?<!No\s+)Dessert\b/gi, '')
      .trim();

  if (!raw.startsWith('{')) {
    return cleanStandardAddons(raw) || null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      pattern_type?: string;
      mwf?: Partial<CurryProfile>;
      tth?: Partial<CurryProfile>;
      extras?: string[];
    };
    const base = formatCustomCurryRule(
      normalizeCurryProfile(parsed.mwf),
      normalizeCurryProfile(parsed.tth),
      parsed.pattern_type
    );

    let finalInstruction = base || '';
    if (Array.isArray(parsed.extras)) {
      const filteredExtras = parsed.extras.filter(
        (extra) => extra !== 'Salad' && extra !== 'Dessert'
      );
      if (filteredExtras.length > 0) {
        finalInstruction += (finalInstruction ? ' + ' : '') + filteredExtras.join(' + ');
      }
    }

    return cleanStandardAddons(finalInstruction) || null;
  } catch {
    return cleanStandardAddons(raw) || null;
  }
};

const overrideHasMealSnapshot = (override: DailyOverrideRow): boolean =>
  override.meal_type !== null ||
  override.portion_size !== null ||
  override.roti_count !== null ||
  override.pronthi_count !== null ||
  override.rice_count !== null ||
  override.dietary_notes !== null ||
  override.delivery_instructions !== null ||
  override.is_custom_curry !== null ||
  override.curry_config !== null;

const applyDailyOverride = (customer: Customer, override: DailyOverrideRow): Customer => {
  const isSkipped = override.is_skipped === true;
  if (isSkipped || !overrideHasMealSnapshot(override)) {
    return { ...customer, isSkipped };
  }
  return {
    ...customer,
    meal_type: override.meal_type ?? customer.meal_type ?? 'VEG',
    portion_size: override.portion_size ?? customer.portion_size ?? 'LG',
    roti_count: override.roti_count ?? customer.roti_count ?? 0,
    pronthi_count: override.pronthi_count ?? customer.pronthi_count ?? 0,
    rice_count: override.rice_count ?? customer.rice_count ?? null,
    dietary_notes: override.dietary_notes ?? null,
    delivery_instructions: override.delivery_instructions ?? null,
    is_custom_curry: override.is_custom_curry ?? null,
    curry_config: override.curry_config ?? customer.curry_config ?? null,
    isSkipped,
  };
};

const buildSkipOverrideRow = (
  customerId: string,
  dateKey: string,
  isSkipped: boolean,
): DailyOverrideRow => ({
  customer_id: customerId,
  override_date: dateKey,
  meal_type: null,
  portion_size: null,
  roti_count: null,
  pronthi_count: null,
  rice_count: null,
  dietary_notes: null,
  delivery_instructions: null,
  is_custom_curry: null,
  curry_config: null,
  is_skipped: isSkipped,
});

const curryCountsAreEqual = (a: CurryProfile, b: CurryProfile): boolean =>
  a.dal === b.dal && a.sabji === b.sabji && a.chicken === b.chicken && a.gravy === b.gravy;

const parseCurryCountText = (instructions: string | null | undefined): CurryProfile => {
  const text = String(instructions || '').trim().toLowerCase();
  if (!text || text === 'none' || text === '—') return { dal: 0, sabji: 0, chicken: 0, gravy: 0 };
  const extract = (keyword: string): number => {
    const xMatch = text.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}\\b`));
    if (xMatch) return parseInt(xMatch[1], 10);
    const plainMatch = text.match(new RegExp(`(\\d+)\\s*${keyword}\\b`));
    if (plainMatch) return parseInt(plainMatch[1], 10);
    if (text.includes(`both ${keyword}`)) return 2;
    return text.includes(keyword) ? 1 : 0;
  };
  return {
    dal: extract('dal'),
    sabji: extract('sabji'),
    chicken: extract('chicken'),
    gravy: extract('gravy'),
  };
};

const formatTodayCurryText = (p: CurryProfile): string => {
  const parts: string[] = [];
  const push = (count: number, label: string): void => {
    if (count > 0) parts.push(count === 1 ? `1 ${label}` : `${count}x ${label}`);
  };
  push(p.dal, 'Dal');
  push(p.sabji, 'Sabji');
  push(p.chicken, 'Chicken');
  push(p.gravy, 'Gravy');
  return parts.join(' + ');
};

const normalizeRiceText = (value: string | null | undefined): string => {
  const t = String(value || '').trim();
  return !t || t === 'None' || t === '—' ? '' : t;
};

const describeTodayOverride = (
  base: Customer,
  override: DailyOverrideRow,
): string => {
  const tokens: string[] = [];

  const baseNonVeg = (base.meal_type || '').toLowerCase().includes('non');
  const overrideNonVeg = (override.meal_type ?? base.meal_type ?? '')
    .toLowerCase()
    .includes('non');
  if (baseNonVeg !== overrideNonVeg) tokens.push(overrideNonVeg ? 'Non-Veg' : 'Veg');

  const basePortion = normalizePortionToken(base.portion_size);
  const overridePortion = normalizePortionToken(override.portion_size ?? base.portion_size);
  if (basePortion !== overridePortion) {
    tokens.push(`${formatPortionLabel(override.portion_size)} portion`);
  }

  const baseCounts = parseCurryCountText(base.delivery_instructions);
  const overrideCounts = parseCurryCountText(
    override.delivery_instructions ?? base.delivery_instructions,
  );
  if (!curryCountsAreEqual(baseCounts, overrideCounts)) {
    tokens.push(formatTodayCurryText(overrideCounts));
  }

  const overrideRoti = override.roti_count ?? base.roti_count;
  if (base.roti_count !== overrideRoti) tokens.push(`Roti ${overrideRoti}`);
  const overridePronthi = override.pronthi_count ?? base.pronthi_count;
  if (base.pronthi_count !== overridePronthi) tokens.push(`Pronthi ${overridePronthi}`);

  const baseRice = normalizeRiceText(base.rice_count);
  const overrideRice = normalizeRiceText(override.rice_count ?? base.rice_count);
  if (baseRice !== overrideRice) tokens.push(`Rice ${overrideRice || 'None'}`);

  if ((base.dietary_notes || '').trim() !== (override.dietary_notes || '').trim()) {
    tokens.push('Updated notes');
  }

  return tokens.length > 0 ? tokens.join(' · ') : 'one-time change';
};

const STANDARD_CURRY_TOKEN = /\b(?:1|one)\s*x?\s*(?:dal|daal|sabji|chicken|gravy)\b/gi;

const stripStandardMealText = (text: string): string =>
  String(text || '')
    .replace(/\(weekly\)/gi, ' ')
    .replace(STANDARD_CURRY_TOKEN, ' ')
    .replace(/(\d+)?\s*x?\s*(salad|dessert)\b/gi, (match, count) =>
      count === undefined || count === '1' ? ' ' : match
    )
    .replace(/\bweekly\b/gi, ' ')
    .replace(/[+·|,]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const isStandardOnlyNote = (part: string): boolean =>
  stripStandardMealText(part).replace(/[\s()+.\-]/g, '') === '';

const resolveSideAlert = (text: string, keyword: string, label: string): string | null => {
  if (new RegExp(`\\bno\\s+${keyword}\\b`).test(text)) return `No ${label}`;
  const xMatch = text.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}\\b`));
  const plainMatch = text.match(new RegExp(`(\\d+)\\s*${keyword}\\b`));

  const count = xMatch
    ? parseInt(xMatch[1], 10)
    : plainMatch
      ? parseInt(plainMatch[1], 10)
      : null;
  if (count === null || count === 1) return null;
  return `${count}x ${label}`;
};

const formatSidesBadge = (salad: number, dessert: number): string => {
  const parts: string[] = [];
  if (salad > 0) parts.push(salad > 1 ? `${salad}S` : 'S');
  if (dessert > 0) parts.push(dessert > 1 ? `${dessert}D` : 'D');

  return parts.length > 0 ? parts.join('+') : '—';
};

const buildAlertSummary = (input: {
  customRule: string | null;
  todayOverride: string | null;
  notes: string | null;
  deliveryInstructions: string | null;
  isNonVeg: boolean;
  isChickenDay: boolean;
}): string | null => {
  const tokens: string[] = [];
  if (input.todayOverride) tokens.push(input.todayOverride);
  if (input.customRule) tokens.push(input.customRule);

  const normalized = `${input.deliveryInstructions || ''} ${input.notes || ''} ${input.customRule || ''
    }`
    .toLowerCase()
    .replace(/daal/g, 'dal');

  if (!input.customRule && !input.todayOverride) {
    const baseline = input.isNonVeg && input.isChickenDay
      ? { dal: 0, sabji: 1, chicken: 1, gravy: 0 }
      : { dal: 1, sabji: 1, chicken: 0, gravy: 0 };
    const labelFor: Record<keyof typeof baseline, string> = {
      dal: 'Daal', sabji: 'Sabji', chicken: 'Chicken', gravy: 'Gravy',
    };
    const explicitCount = (keyword: string): number | null => {
      const xMatch = normalized.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}\\b`));
      if (xMatch) return parseInt(xMatch[1], 10);
      const plainMatch = normalized.match(new RegExp(`(\\d+)\\s*${keyword}\\b`));
      if (plainMatch) return parseInt(plainMatch[1], 10);
      return null;
    };
    (Object.keys(labelFor) as Array<keyof typeof baseline>).forEach(key => {
      const count = explicitCount(key);
      if (count === null || count === baseline[key]) return;

      if (!input.isChickenDay && (key === 'chicken' || key === 'gravy') && count === 1) return;
      if (input.isChickenDay && input.isNonVeg && key === 'chicken' && count === 1) return;

      tokens.push(count === 0 ? `No ${labelFor[key]}` : `${count} ${labelFor[key]}`);
    });
    for (const match of normalized.matchAll(/\bno\s+(dal|sabji|chicken|gravy)\b/g)) {
      const item = match[1] as keyof typeof baseline;
      if (!input.isChickenDay && (item === 'chicken' || item === 'gravy')) continue;
      tokens.push(`No ${labelFor[item]}`);
    }
  }

  if (input.notes) {
    input.notes
      .split(/[·|\n]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => !isStandardOnlyNote(part))
      .forEach(part => tokens.push(part));
  }

  const saladAlert = resolveSideAlert(normalized, 'salad', 'Salad');
  if (saladAlert) tokens.push(saladAlert);
  const dessertAlert = resolveSideAlert(normalized, 'dessert', 'Dessert');
  if (dessertAlert) tokens.push(dessertAlert);

  if (/\bextra\s+roti\b/.test(normalized)) tokens.push('Extra Roti');
  if (/\bcarry\s*bag\b/.test(normalized)) tokens.push('Carry Bag');

  const seen = new Set<string>();
  const unique = tokens.filter(token => {
    const key = token.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const collapsed = unique.filter(token => {
    const key = token.toLowerCase().replace(/\s+/g, ' ').trim();
    return !unique.some(
      other =>
        other !== token &&
        other.toLowerCase().replace(/\s+/g, ' ').includes(key)
    );
  });

  const cleaned = collapsed.map(token => {
    return stripStandardMealText(token).trim() || token;
  });

  return cleaned.length > 0 ? cleaned.join(' · ') : null;
};

// Count hint helper for whole produce items (e.g. Medium Tomatoes)
const getIngredientCountHint = (ingredientName: string, totalOz: number): string | null => {
  const lower = ingredientName.toLowerCase();
  if (lower.includes('tomato')) {
    const count = Math.round((totalOz / 4.2) * 2) / 2;
    const roundedInt = Math.round(count);
    return count < 1 ? '~1 med' : `~${roundedInt} med`;
  }
  return null;
};

type QuickSaveRequest = QuickEditSaveRequest;

export default function PrepDashboardClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    resolveNextActiveDeliveryDate(initialCustomers)
  );

  const activeDay = DAYS_OF_WEEK[(selectedDate.getDay() + 6) % 7];

  const [veg1, setVeg1] = useState<string>('');
  const [veg2, setVeg2] = useState<string>('');
  const [nonVeg, setNonVeg] = useState<string>('Chicken Curry');
  const [isMenuLoading, setIsMenuLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [availableRecipes, setAvailableRecipes] = useState<{ dal: Recipe[]; sabji: Recipe[] }>({ dal: [], sabji: [] });

  const [batchRecipes, setBatchRecipes] = useState<RecipeWithIngredients[]>([]);
  const [selectedDalId, setSelectedDalId] = useState<string>('');
  const [selectedSabjiId, setSelectedSabjiId] = useState<string>('');
  const [menuSelectionError, setMenuSelectionError] = useState<string | null>(null);
  const [isMenuSelectionSaving, setIsMenuSelectionSaving] = useState(false);

  const [quickEditCustomer, setQuickEditCustomer] = useState<Customer | null>(null);
  const [quickEditResetToken, setQuickEditResetToken] = useState(0);
  const [isQuickSaving, startQuickSaveTransition] = useTransition();
  const [quickSaveError, setQuickSaveError] = useState<string | null>(null);
  const [isSkipPending, startSkipTransition] = useTransition();
  const [isVacationPending, startVacationTransition] = useTransition();
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Customer>>>({});
  const [overridesByDate, setOverridesByDate] = useState<
    Record<string, Record<string, DailyOverrideRow>>
  >({});
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const [schemaReloading, setSchemaReloading] = useState(false);
  const router = useRouter();

  const openQuickEdit = (customer: Customer) => {
    setQuickEditCustomer(customer);
    setQuickSaveError(null);
  };

  const handleQuickSave = (request: QuickSaveRequest) => {
    if (!quickEditCustomer) return;
    const target = quickEditCustomer;
    const { scope, startDate, endDate, isSkipped: skipRequested, config } = request;
    const changedKeys = Object.keys(config) as (keyof MealConfigPayload)[];
    const todayOverride = dailyOverrides[target.id];
    const skipChanged = skipRequested !== (todayOverride?.is_skipped === true);
    const isNoOp =
      scope === 'permanent'
        ? changedKeys.length === 0 && !todayOverride
        : changedKeys.length === 0 && !skipChanged;

    if (isNoOp) {
      setQuickEditCustomer(null);
      return;
    }

    setQuickEditCustomer(null);
    setQuickSaveError(null);

    const selectedInWindow = selectedDateKey >= startDate && selectedDateKey <= endDate;

    if (scope === 'permanent') {
      if (changedKeys.length > 0) {
        setLocalEdits(prev => ({
          ...prev,
          [target.id]: { ...(prev[target.id] || {}), ...config },
        }));
      }
      if (todayOverride) {
        setOverridesByDate(prev => {
          const day = { ...(prev[selectedDateKey] || {}) };
          delete day[target.id];
          return { ...prev, [selectedDateKey]: day };
        });
      }

      startQuickSaveTransition(async () => {
        try {
          const result = await saveCustomerOverride({
            customerId: target.id,
            scope,
            startDate: selectedDateKey,
            endDate: selectedDateKey,
            isSkipped: false,
            mealConfig: changedKeys.length > 0 ? config : {},
          });
          if (!result.success) {
            if (!result.schemaAvailable) {
              setPersistenceWarning(formatOverrideUnavailableWarning(result.message));
            } else {
              throw new Error(result.message || 'Could not save meal config. Please try again.');
            }
          }
          router.refresh();
          void refreshDailyOverrides(selectedDateKey);
        } catch (err) {
          if (changedKeys.length > 0) {
            setLocalEdits(prev => {
              const next = { ...prev };
              const merged = { ...(next[target.id] || {}) };
              changedKeys.forEach(key => delete merged[key]);
              if (Object.keys(merged).length > 0) next[target.id] = merged;
              else delete next[target.id];
              return next;
            });
          }
          if (todayOverride) {
            setOverridesByDate(prev => {
              const day = { ...(prev[selectedDateKey] || {}) };
              day[target.id] = todayOverride;
              return { ...prev, [selectedDateKey]: day };
            });
          }
          setQuickEditCustomer(target);
          setQuickSaveError(err instanceof Error ? err.message : 'Could not save meal config. Please try again.');
          console.error('[Prep] Meal config quick-save failed:', err);
        }
      });
      return;
    }

    const previousRow = overridesByDate[selectedDateKey]?.[target.id];
    const optimisticRow: DailyOverrideRow = skipRequested
      ? previousRow
        ? { ...previousRow, is_skipped: true }
        : buildSkipOverrideRow(target.id, selectedDateKey, true)
      : {
        customer_id: target.id,
        override_date: selectedDateKey,
        meal_type: config.meal_type ?? target.meal_type ?? null,
        portion_size: config.portion_size ?? target.portion_size ?? null,
        roti_count: config.roti_count ?? target.roti_count ?? null,
        pronthi_count: config.pronthi_count ?? target.pronthi_count ?? null,
        rice_count: config.rice_count ?? target.rice_count ?? null,
        dietary_notes:
          config.dietary_notes !== undefined
            ? config.dietary_notes
            : target.dietary_notes ?? null,
        delivery_instructions:
          config.delivery_instructions !== undefined
            ? config.delivery_instructions
            : target.delivery_instructions ?? null,
        is_custom_curry:
          config.is_custom_curry !== undefined
            ? config.is_custom_curry
            : target.is_custom_curry ?? null,
        curry_config:
          config.curry_config !== undefined
            ? config.curry_config
            : target.curry_config ?? null,
        is_skipped: false,
      };

    if (selectedInWindow) {
      setOverridesByDate(prev => {
        const day = { ...(prev[selectedDateKey] || {}) };
        day[target.id] = optimisticRow;
        return { ...prev, [selectedDateKey]: day };
      });
    }

    startQuickSaveTransition(async () => {
      try {
        const result = await saveCustomerOverride({
          customerId: target.id,
          scope,
          startDate,
          endDate,
          isSkipped: skipRequested,
          mealConfig: config,
        });
        if (!result.success) {
          if (!result.schemaAvailable) {
            setPersistenceWarning(formatOverrideUnavailableWarning(result.message));
          } else {
            throw new Error(result.message || 'Could not save the override. Please try again.');
          }
        }
        router.refresh();
        void refreshDailyOverrides(selectedDateKey);
      } catch (err) {
        if (selectedInWindow) {
          setOverridesByDate(prev => {
            const day = { ...(prev[selectedDateKey] || {}) };
            if (previousRow) day[target.id] = previousRow;
            else delete day[target.id];
            return { ...prev, [selectedDateKey]: day };
          });
        }
        setQuickEditCustomer(target);
        setQuickSaveError(err instanceof Error ? err.message : 'Could not save the override. Please try again.');
        console.error('[Prep] Override quick-save failed:', err);
      }
    });
  };

  const closeQuickEdit = () => {
    setQuickEditCustomer(null);
    setQuickSaveError(null);
  };

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveInFlightRef = useRef(false);

  const selectedDateKey = toLocalDateKey(selectedDate);
  const dateStr = selectedDateKey;

  const selectedDateFormatted = selectedDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(selectedDate.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  });

  const formattedTargetDate = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(selectedDate.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  });

  const printDeliveryDateLabel = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const isPreppingTomorrow = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toLocalDateKey(tomorrow) === selectedDateKey;
  }, [selectedDateKey]);

  const applyOverrideRows = useCallback(
    (dateKey: string, rows: DailyOverrideRow[]) => {
      const byCustomer: Record<string, DailyOverrideRow> = {};
      rows.forEach(row => {
        byCustomer[row.customer_id] = row;
      });
      setOverridesByDate(prev => ({ ...prev, [dateKey]: byCustomer }));
    },
    []
  );

  const refreshDailyOverrides = useCallback(
    async (
      dateKey: string
    ): Promise<{ schemaAvailable: boolean; message?: string }> => {
      const result = await getDailyOverrides(dateKey);
      if (result.schemaAvailable) {
        applyOverrideRows(dateKey, result.rows);
        return { schemaAvailable: true };
      }
      console.warn(
        '[Prep] customer_daily_overrides unavailable; keeping session-local overrides.',
        result.message ?? ''
      );
      return { schemaAvailable: false, message: result.message };
    },
    [applyOverrideRows]
  );

  const dailyOverrides = overridesByDate[selectedDateKey] || EMPTY_OVERRIDES;

  const handleToggleSkip = (customerId: string, nextSkipped: boolean) => {
    const previousRow = overridesByDate[selectedDateKey]?.[customerId];
    setQuickSaveError(null);

    setOverridesByDate(prev => {
      const day = { ...(prev[selectedDateKey] || {}) };
      const existing = day[customerId];
      if (nextSkipped) {
        day[customerId] = existing
          ? { ...existing, is_skipped: true }
          : buildSkipOverrideRow(customerId, selectedDateKey, true);
      } else {
        delete day[customerId];
      }
      return { ...prev, [selectedDateKey]: day };
    });

    const revert = () => {
      setOverridesByDate(prev => {
        const day = { ...(prev[selectedDateKey] || {}) };
        if (previousRow) day[customerId] = previousRow;
        else delete day[customerId];
        return { ...prev, [selectedDateKey]: day };
      });
    };

    startSkipTransition(async () => {
      try {
        const result = await toggleDailySkip({
          customerId,
          date: selectedDateKey,
          skipState: nextSkipped,
        });
        if (!result.success) {
          revert();
          if (!result.schemaAvailable) {
            setPersistenceWarning(formatOverrideUnavailableWarning(result.message));
          } else {
            setQuickSaveError(
              result.message || 'Could not update the skip. Please try again.'
            );
          }
          return;
        }
        router.refresh();
        void refreshDailyOverrides(selectedDateKey);
      } catch (err) {
        revert();
        setQuickSaveError(
          err instanceof Error ? err.message : 'Could not update the skip. Please try again.'
        );
        console.error('[Prep] Daily skip toggle failed:', err);
      }
    });
  };

  const handleCancelVacationPause = (customerId: string) => {
    setQuickSaveError(null);
    startVacationTransition(async () => {
      try {
        const result = await cancelVacationPause({ customerId });
        if (!result.success) {
          if (!result.schemaAvailable) {
            setPersistenceWarning(formatOverrideUnavailableWarning(result.message));
          } else {
            throw new Error(
              result.message || 'Could not cancel the vacation pause. Please try again.'
            );
          }
          return;
        }
        setQuickEditCustomer(prev =>
          prev ? { ...prev, pause_start_date: null, pause_end_date: null } : prev
        );
        router.refresh();
        void refreshDailyOverrides(selectedDateKey);
      } catch (err) {
        setQuickSaveError(
          err instanceof Error
            ? err.message
            : 'Could not cancel the vacation pause. Please try again.'
        );
        console.error('[Prep] Vacation pause cancel failed:', err);
      }
    });
  };

  const handleClearOverride = () => {
    if (!quickEditCustomer) return;
    const target = quickEditCustomer;
    const previousRow = overridesByDate[selectedDateKey]?.[target.id];

    if (!previousRow) {
      setQuickEditCustomer(baseCustomerById.get(target.id) ?? target);
      setQuickEditResetToken(token => token + 1);
      return;
    }

    setQuickSaveError(null);

    setOverridesByDate(prev => {
      const day = { ...(prev[selectedDateKey] || {}) };
      delete day[target.id];
      return { ...prev, [selectedDateKey]: day };
    });

    startQuickSaveTransition(async () => {
      try {
        const result = await clearDailyOverride({
          customerId: target.id,
          date: selectedDateKey,
        });
        if (!result.success) {
          if (!result.schemaAvailable) {
            setPersistenceWarning(formatOverrideUnavailableWarning(result.message));
          } else {
            throw new Error(
              result.message || 'Could not reset to the master profile. Please try again.'
            );
          }
        }
        setQuickEditCustomer(baseCustomerById.get(target.id) ?? target);
        setQuickEditResetToken(token => token + 1);
        router.refresh();
        void refreshDailyOverrides(selectedDateKey);
      } catch (err) {
        setOverridesByDate(prev => {
          const day = { ...(prev[selectedDateKey] || {}) };
          day[target.id] = previousRow;
          return { ...prev, [selectedDateKey]: day };
        });
        setQuickSaveError(
          err instanceof Error
            ? err.message
            : 'Could not reset to the master profile. Please try again.'
        );
        console.error('[Prep] Reset to master profile failed:', err);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refreshed = await refreshDailyOverrides(selectedDateKey);
      if (cancelled) return;
      if (refreshed.schemaAvailable) {
        setPersistenceWarning(null);
      } else {
        setPersistenceWarning(formatOverrideUnavailableWarning(refreshed.message));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDateKey, refreshDailyOverrides]);

  const handleReloadSchema = useCallback(async () => {
    setSchemaReloading(true);
    setPersistenceWarning(null);
    try {
      const reload = await reloadSchemaCache();
      if (!reload.ok) {
        setPersistenceWarning(
          `Could not reload the schema cache: ${reload.message || 'unknown error'}. ` +
          'Make sure migration 00016 (notify_pgrst_reload) has been applied, then try again.'
        );
        return;
      }
      const probe = await checkDailyOverrideTable();
      if (!probe.exists) {
        setPersistenceWarning(
          `The customer_daily_overrides table still isn't reachable${probe.message ? ` (${probe.message})` : ''
          }.`
        );
        return;
      }
      await refreshDailyOverrides(selectedDateKey);
      setPersistenceWarning(null);
    } finally {
      setSchemaReloading(false);
    }
  }, [refreshDailyOverrides, selectedDateKey]);

  useEffect(() => {
    let cancelled = false;
    setIsMenuLoading(true);
    setSaveStatus('idle');

    (async () => {
      try {
        const data = await fetchDailyMenu(dateStr);
        if (cancelled) return;
        if (data) {
          setVeg1(data.veg_option_1);
          setVeg2(data.veg_option_2);
          setNonVeg(data.chicken_option || 'Chicken Curry');
        } else {
          setVeg1('');
          setVeg2('');
          setNonVeg('Chicken Curry');
        }
      } catch (err) {
        console.error('Failed to load daily menu:', err);
      } finally {
        if (!cancelled) setIsMenuLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dateStr]);

  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');

    saveTimerRef.current = setTimeout(async () => {
      if (saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      try {
        await saveDailyMenu(dateStr, {
          veg_option_1: veg1,
          veg_option_2: veg2,
          chicken_option: nonVeg,
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      } finally {
        saveInFlightRef.current = false;
      }
    }, 1200);
  }, [dateStr, veg1, veg2, nonVeg]);

  useEffect(() => {
    if (!isMenuLoading) triggerAutoSave();
  }, [veg1, veg2, nonVeg, isMenuLoading]);

  const refreshRecipes = useCallback(async () => {
    try {
      const recipes = await getAvailableRecipes();
      setAvailableRecipes(recipes);
    } catch (err) {
      console.error('[Prep] Failed to reload recipes:', err);
    }
  }, []);

  useEffect(() => {
    refreshRecipes();
  }, [refreshRecipes]);

  useEffect(() => {
    (async () => {
      try {
        const catalog = await getRecipesWithIngredients();
        setBatchRecipes(catalog);
      } catch (err) {
        console.error('[Prep] Failed to load the recipe catalog:', err);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const selection = await getDailyMenuSelection(selectedDateKey);
        if (cancelled) return;
        setSelectedDalId(selection.dalId || '');
        setSelectedSabjiId(selection.sabjiId || '');
      } catch (err) {
        console.error('[Prep] Failed to load the daily menu selection:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDateKey]);

  const persistMenuSelection = async (dalId: string, sabjiId: string) => {
    setMenuSelectionError(null);
    setIsMenuSelectionSaving(true);
    try {
      const result = await setDailyMenuSelection(selectedDateKey, dalId || null, sabjiId || null);
      if (!result.success) {
        setMenuSelectionError(result.message || 'Could not save the menu selection.');
      }
    } catch (err) {
      setMenuSelectionError(
        err instanceof Error ? err.message : 'Could not save the menu selection.'
      );
    } finally {
      setIsMenuSelectionSaving(false);
    }
  };

  const handleSelectDal = (dalId: string) => {
    setSelectedDalId(dalId);
    const recipe = activeDalRecipes.find(r => r.id === dalId);
    setVeg1(recipe ? recipe.name : '');
    void persistMenuSelection(dalId, selectedSabjiId);
  };

  const handleSelectSabji = (sabjiId: string) => {
    setSelectedSabjiId(sabjiId);
    const recipe = activeSabjiRecipes.find(r => r.id === sabjiId);
    setVeg2(recipe ? recipe.name : '');
    void persistMenuSelection(selectedDalId, sabjiId);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const goToDay = (targetDayName: string) => {
    const targetIndex = DAYS_OF_WEEK.indexOf(targetDayName);
    if (targetIndex === -1) return;
    const jsTargetDay = targetIndex < 6 ? targetIndex + 1 : 0;
    const diff = jsTargetDay - selectedDate.getDay();
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + diff);
    setSelectedDate(newDate);
  };

  const isChickenDay = useMemo(() => {
    return ['Monday', 'Wednesday', 'Friday'].includes(activeDay);
  }, [activeDay]);

  const isVegDay = !isChickenDay;

  const mergedCustomers = useMemo(() => {
    return initialCustomers.map(customer => {
      const edit = localEdits[customer.id];
      return edit ? { ...customer, ...edit } : customer;
    });
  }, [initialCustomers, localEdits]);

  const resolvedCustomers = useMemo(() => {
    return mergedCustomers.map(customer => {
      const override = dailyOverrides[customer.id];
      return override ? applyDailyOverride(customer, override) : customer;
    });
  }, [mergedCustomers, dailyOverrides]);

  const baseCustomerById = useMemo(() => {
    const byId = new Map<string, Customer>();
    mergedCustomers.forEach(customer => byId.set(customer.id, customer));
    return byId;
  }, [mergedCustomers]);

  const activeCustomers = useMemo(() => {
    return resolvedCustomers.filter(customer =>
      isScheduledOn(customer, activeDay, selectedDateKey)
    );
  }, [resolvedCustomers, activeDay, selectedDateKey]);

  const manifestCustomers = useMemo(() =>
    [...activeCustomers].sort(kitchenOrderSort),
    [activeCustomers],
  );

  const metrics = useMemo(
    () => computePrepMetrics(activeCustomers, isChickenDay),
    [activeCustomers, isChickenDay],
  );

  const chickenStationPackLG = metrics.chickenPackLG + metrics.gravyPackLG;
  const chickenStationPackRG = metrics.chickenPackRG + metrics.gravyPackRG;

  const activeDalRecipes = useMemo(
    () => batchRecipes.filter(r => r.category === 'dal' && r.is_active !== false),
    [batchRecipes],
  );
  const activeSabjiRecipes = useMemo(
    () => batchRecipes.filter(r => r.category === 'sabji' && r.is_active !== false),
    [batchRecipes],
  );

  const selectedDalRecipe = useMemo(
    () => batchRecipes.find(r => r.id === selectedDalId) ?? null,
    [batchRecipes, selectedDalId],
  );
  const selectedSabjiRecipe = useMemo(
    () => batchRecipes.find(r => r.id === selectedSabjiId) ?? null,
    [batchRecipes, selectedSabjiId],
  );

  const formatOz = (oz: number): string => `${oz.toFixed(1)} oz`;
  const formatWeight = (oz: number): string => {
    const grams = oz * 28.3495;
    return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
  };

  const buildBatchRows = (
    recipe: RecipeWithIngredients | null,
    count8oz: number,
    count12oz: number,
  ) =>
    recipe
      ? recipe.ingredients.map(ing => ({
        id: ing.id,
        name: ing.name,
        totalOz: count8oz * ing.raw_oz_per_8oz + count12oz * ing.raw_oz_per_12oz,
      }))
      : [];

  const dalBatchRows = buildBatchRows(selectedDalRecipe, metrics.dalPackRG, metrics.dalPackLG);
  const sabjiBatchRows = buildBatchRows(selectedSabjiRecipe, metrics.sabjiPackRG, metrics.sabjiPackLG);

  const printDalName = selectedDalRecipe?.name || (veg1 || '').trim() || '—';
  const printSabjiName = selectedSabjiRecipe?.name || (veg2 || '').trim() || '—';
  const printChickenName = isChickenDay ? (nonVeg || '').trim() || 'Chicken Curry' : null;

  const printedSideParts: string[] = [];
  if (metrics.saladCount > 0) printedSideParts.push(`Salad: ${metrics.saladCount}`);
  if (metrics.dessertCount > 0) printedSideParts.push(`Dessert: ${metrics.dessertCount}`);
  const printSidesLabel = printedSideParts.length > 0 ? printedSideParts.join(', ') : '—';

  const sabjiBreakdownLines = formatBatchBreakdownLines(sabjiBatchRows);
  const dalBreakdownLines = formatBatchBreakdownLines(dalBatchRows);

  return (
    <div className="flex flex-col h-screen bg-[#F9FBFC] overflow-hidden font-sans text-[#292D32] print:h-auto print:overflow-visible print:bg-white">

      {/* HEADER SECTION */}
      <div className="bg-white border-b border-[#EEEEEE] shrink-0 print:hidden">
        <div className="px-8 py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold text-[#11142D]">Kitchen Prep and Packaging</h1>
              <span className="px-3 py-1 rounded-md text-[11px] font-black bg-gray-100 text-gray-700 border border-gray-200 uppercase tracking-wider">
                🚚 {metrics.totalMeals} deliveries
              </span>
              <span className="text-base text-gray-500 font-semibold border-l border-gray-200 pl-3">
                For Delivery: {formattedTargetDate}
              </span>
              {isPreppingTomorrow && (
                <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full">
                  🌙 Prepping for Tomorrow
                </span>
              )}
            </div>
            <p className="text-[13px] text-gray-500 mt-1">Real-time production metrics for line chefs.</p>
          </div>
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 rounded-md text-[11px] font-black tracking-wider uppercase border shadow-sm ${isChickenDay
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
                  className={`px-4 py-1.5 text-[12px] font-bold rounded-md transition-all ${activeDay === day
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
              value={selectedDateKey}
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
      <div className="flex-1 overflow-y-auto p-8 space-y-6 print:flex-none print:h-auto print:overflow-visible print:p-3">

        {/* PRINT-ONLY KITCHEN MANIFEST */}
        <div
          className="hidden print:block mb-3 border border-black break-inside-avoid"
          style={{ pageBreakInside: 'avoid' }}
        >
          <div className="flex items-center justify-between gap-4 px-3 py-2 border-b border-black">
            <h2 className="text-2xl font-black tracking-tight leading-none text-black">
              {printDeliveryDateLabel}
            </h2>
            <span className="shrink-0 text-xl font-black tracking-wide text-black whitespace-nowrap">
              {metrics.totalMeals} TOTAL ORDERS
            </span>
          </div>

          <div className="grid grid-cols-4 divide-x divide-black border-b border-black">
            <div className="p-2 min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wide text-black">
                Sabji · {printSabjiName}
              </span>
              <span className="mt-0.5 block text-2xl font-black text-black">
                {metrics.sabjiOz} oz
              </span>
              <p className="text-[11px] font-bold leading-snug text-black">
                Regular: {metrics.sabjiPackRG}, Large: {metrics.sabjiPackLG}
              </p>
              {/* Change text-[10px] leading-snug to text-[9px] leading-tight */}
<div className="mt-1 space-y-0.5 text-[9px] font-medium leading-tight text-black">
  {sabjiBreakdownLines.map((line, index) => (
    <div key={index} className="truncate">• {line}</div>
  ))}
</div>
            </div>

            <div className="p-2 min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wide text-black">
                Daal · {printDalName}
              </span>
              <span className="mt-0.5 block text-2xl font-black text-black">
                {metrics.dalOz} oz
              </span>
              <p className="text-[11px] font-bold leading-snug text-black">
                Regular: {metrics.dalPackRG}, Large: {metrics.dalPackLG}
              </p>
              <div className="mt-1 space-y-0.5 text-[9px] font-medium leading-tight text-black">
  {dalBreakdownLines.map((line, index) => (
    <div key={index} className="truncate">• {line}</div>
  ))}
</div>
            </div>

            <div className="p-2 min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wide text-black">
                Chicken · {printChickenName || 'Veg Day'}
              </span>
              {isChickenDay ? (
                <>
                  <span className="mt-0.5 block text-xl font-bold text-black">
                    {metrics.chickenLegs} Legs
                  </span>
                  <p className="text-[11px] font-bold leading-snug text-black">
                    Regular: {chickenStationPackRG}, Large: {chickenStationPackLG}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[10.5px] font-bold leading-snug text-black">
                  Veg Day — chicken station idle.
                </p>
              )}
            </div>

            <div className="p-2 min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wide text-black">
                Breads &amp; Sides
              </span>
              <span className="mt-0.5 block text-2xl font-black text-black">
                {metrics.totalRoti} Roti
                {metrics.totalPronthi > 0 ? ` + ${metrics.totalPronthi} Pronthi` : ''}
              </span>
              <p className="text-[11px] font-bold leading-snug text-black">
                Rice — Regular: {metrics.rice.rg}, Large: {metrics.rice.lg}
                {metrics.rice.xl > 0 ? `, XL: ${metrics.rice.xl}` : ''}
              </p>
              <p className="mt-1 text-[11px] font-bold leading-snug text-black break-words">
                {printSidesLabel}
              </p>
            </div>
          </div>
        </div>

        {/* PRINT-ONLY COMPACT PACKING ROSTER */}
        <div className="hidden print:block print-sheet">
          <table className="w-full">
            <thead>
              <tr>
                <th className="w-[24px] text-center">[ ]</th>
                <th className="text-left">CUSTOMER</th>
                <th className="text-left">STREET / BLDG</th>
                <th className="w-[34px] text-center">SIZE</th>
                <th className="w-[38px] text-center">TYPE</th>
                <th className="w-[44px] text-center">ROTI</th>
                <th className="w-[58px] text-center">RICE</th>
                <th className="text-left">ALERTS / SPECIAL</th>
              </tr>
            </thead>
            <tbody>
              {manifestCustomers.filter(c => !c.isSkipped).length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center">
                    No active kitchen deliveries routed for {activeDay}.
                  </td>
                </tr>
              ) : (
                manifestCustomers
                  .filter(c => !c.isSkipped)
                  .map(customer => {
                    const override = dailyOverrides[customer.id];
                    const baseRow = baseCustomerById.get(customer.id);
                    const todayDeviation =
                      override && baseRow && overrideHasMealSnapshot(override)
                        ? describeTodayOverride(baseRow, override)
                        : null;
                    const hasTodayOverride =
                      todayDeviation !== null && todayDeviation !== 'one-time change';
                    const todayOverrideLabel = hasTodayOverride
                      ? `⚡ Today: ${todayDeviation}`
                      : null;
                    const customRule = hasTodayOverride
                      ? null
                      : getCustomInstructionsText(customer);
                    const rawNotes = [
                      customer.dietary_notes,
                      customer.notes,
                      customer.side_notes,
                      customer.custom_instructions,
                    ].filter(
                      (v): v is string =>
                        typeof v === 'string' &&
                        v.trim() !== '' &&
                        v.trim() !== '—' &&
                        v.trim() !== 'None'
                    );
                    const sideAddons = resolveSideAddons(customer);
                    const portion = (customer.portion_size || '').toLowerCase();
                    const isLg = portion.includes('lg') || portion.includes('large');

                    const isDefaultSides = isLg
                      ? sideAddons.salad === 1 && sideAddons.dessert === 1
                      : sideAddons.salad === 0 && sideAddons.dessert === 0;

                    const currentSidesBadge = isDefaultSides
                      ? '—'
                      : formatSidesBadge(sideAddons.salad, sideAddons.dessert);

                    let filteredRawNotes = [...rawNotes];

                    if (currentSidesBadge !== '—') {
                      const badgeHasSalad = currentSidesBadge.includes('S');
                      const badgeHasDessert = currentSidesBadge.includes('D');

                      filteredRawNotes = filteredRawNotes.filter(note => {
                        const trimmedNote = note.trim();
                        if (badgeHasSalad && trimmedNote.match(/^(\d+x?|No)\s*Salad/i)) return false;
                        if (badgeHasDessert && trimmedNote.match(/^(\d+x?|No)\s*Dessert/i)) return false;
                        return true;
                      });
                    }
                    const noteText =
                      filteredRawNotes.length > 0
                        ? [...new Set(filteredRawNotes.map(v => v.trim()))].join(' · ')
                        : null;
                    const alertText = buildAlertSummary({
                      customRule,
                      todayOverride: todayOverrideLabel,
                      notes: noteText,
                      deliveryInstructions: customer.delivery_instructions,
                      isNonVeg: (customer.meal_type || '').toLowerCase().includes('non'),
                      isChickenDay,
                    });
                    const street = isPickupOnDay(customer, activeDay)
                      ? 'PU'
                      : formatShortAddress(customer.delivery_address) || '—';
                    const hasPronthi =
                      typeof customer.pronthi_count === 'number' && customer.pronthi_count > 0;
                    const rotiText =
                      typeof customer.roti_count === 'number' && customer.roti_count > 0
                        ? `${customer.roti_count}${hasPronthi ? ` +${customer.pronthi_count}P` : ''}`
                        : hasPronthi
                          ? `${customer.pronthi_count}P`
                          : '—';
                    const riceText = formatShortRice(customer.rice_count);
                    return (
                      <tr
                        key={customer.id}
                        className="break-inside-avoid"
                        style={{ pageBreakInside: 'avoid' }}
                      >
                        <td className="text-center align-middle">
                          <span className="inline-block w-3.5 h-3.5 border border-black align-middle" />
                        </td>
                        <td className="text-left font-bold break-words">{customer.full_name}</td>
                        <td className="text-left break-words">{street}</td>
                        <td className="text-center font-black">
                          {formatSizeBadge(customer.portion_size)}
                        </td>
                        <td className="text-center font-black">
                          {formatTypeBadge(customer.meal_type)}
                        </td>
                        <td className="text-center font-bold">{rotiText}</td>
                        <td className="text-center font-bold">{riceText}</td>
                        <td className="text-left font-black uppercase break-words">
                          {alertText ?? '—'}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>

        {/* Degraded-persistence banner */}
        {persistenceWarning && (
          <div className="flex items-start justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[12.5px] font-semibold print:hidden">
            <div className="flex items-start gap-2 min-w-0 leading-snug">
              <span aria-hidden="true">⚠️</span>
              <span>{persistenceWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleReloadSchema()}
              disabled={schemaReloading}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11.5px] font-bold transition-colors disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
            >
              {schemaReloading ? 'Reloading…' : 'Reload schema & retry'}
            </button>
          </div>
        )}

        {/* TODAY'S KITCHEN MENU + BATCH PREP CALCULATOR */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:hidden items-start">
          <div className="bg-white rounded-xl border border-[#EEEEEE] shadow-sm p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">
                  🍽️ Today&apos;s Kitchen Menu
                </span>
                <a
                  href="/admin/recipes"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#5D5FEF] hover:text-white border border-[#EFEEFC] px-2 py-0.5 rounded transition-colors"
                >
                  ⚙️ Manage Recipes
                </a>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">
                  {isMenuSelectionSaving ? '⏳ Saving...' : '✓ Saved'}
                </span>
                <span className="text-[11px] font-semibold text-gray-400">
                  {formattedTargetDate}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold text-amber-700 uppercase tracking-wider">
                  Today&apos;s Dal
                </span>
                <select
                  value={selectedDalId}
                  onChange={e => handleSelectDal(e.target.value)}
                  className="text-[12.5px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                >
                  <option value="">— Not selected —</option>
                  {activeDalRecipes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold text-green-700 uppercase tracking-wider">
                  Today&apos;s Sabji
                </span>
                <select
                  value={selectedSabjiId}
                  onChange={e => handleSelectSabji(e.target.value)}
                  className="text-[12.5px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                >
                  <option value="">— Not selected —</option>
                  {activeSabjiRecipes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {menuSelectionError && (
              <p className="mt-3 text-[11.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                ⚠️ {menuSelectionError}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-[#EEEEEE] shadow-sm p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">
                ⚖️ Batch Prep Calculator
              </span>
              <span className="text-[11px] font-semibold text-gray-400">
                {metrics.dalPackRG + metrics.dalPackLG + metrics.sabjiPackRG + metrics.sabjiPackLG} containers
              </span>
            </div>
            {!selectedDalRecipe && !selectedSabjiRecipe ? (
              <p className="text-[12px] text-gray-400 py-6 text-center">
                Select a Dal or Sabji above to see the scaled raw-ingredient weights.
              </p>
            ) : (
              <div className="space-y-4">
                {selectedDalRecipe && (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[12px] font-bold text-amber-700">
                        Dal · {selectedDalRecipe.name}
                      </span>
                      <span className="text-[10.5px] font-bold text-gray-400">
                        {metrics.dalPackRG} × 8 oz (RG) · {metrics.dalPackLG} × 12 oz (LG)
                      </span>
                    </div>
                    {dalBatchRows.length === 0 ? (
                      <p className="text-[11.5px] text-gray-400 italic">
                        No ingredients defined for this recipe.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {dalBatchRows.map(row => {
                          const countHint = getIngredientCountHint(row.name, row.totalOz);
                          return (
                            <li
                              key={row.id}
                              className="flex items-baseline justify-between gap-3 text-[12px] border-b border-gray-50 pb-1"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-semibold text-gray-700 truncate">{row.name}:</span>
                                {countHint && (
                                  <span className="text-[10.5px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                                    {countHint}
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0 font-mono font-bold text-gray-900">
                                {formatOz(row.totalOz)}  ({formatWeight(row.totalOz)})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {selectedSabjiRecipe && (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[12px] font-bold text-green-700">
                        Sabji · {selectedSabjiRecipe.name}
                      </span>
                      <span className="text-[10.5px] font-bold text-gray-400">
                        {metrics.sabjiPackRG} × 8 oz (RG) · {metrics.sabjiPackLG} × 12 oz (LG)
                      </span>
                    </div>
                    {sabjiBatchRows.length === 0 ? (
                      <p className="text-[11.5px] text-gray-400 italic">
                        No ingredients defined for this recipe.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {sabjiBatchRows.map(row => {
                          const countHint = getIngredientCountHint(row.name, row.totalOz);
                          return (
                            <li
                              key={row.id}
                              className="flex items-baseline justify-between gap-3 text-[12px] border-b border-gray-50 pb-1"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-semibold text-gray-700 truncate">{row.name}:</span>
                                {countHint && (
                                  <span className="text-[10.5px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                                    {countHint}
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0 font-mono font-bold text-gray-900">
                                {formatOz(row.totalOz)}  ({formatWeight(row.totalOz)})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3-STATION GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden items-stretch">

          <div className="bg-white rounded-xl border border-[#EEEEEE] shadow-sm p-3 flex flex-col">
            <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide mb-2">🍞 Breads &amp; Sides</span>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Breads</span>
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap">{metrics.totalRoti + metrics.totalPronthi} TOTAL</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium">Roti</span>
                    <span className="font-bold text-gray-900">{metrics.totalRoti}</span>
                  </div>
                  {metrics.totalPronthi > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="bg-amber-400 text-amber-950 font-bold px-1.5 py-0.5 rounded text-[10px]">Pronthi</span>
                      <span className="font-bold text-gray-900">{metrics.totalPronthi}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Rice</span>
                  <span className="text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded whitespace-nowrap">{metrics.totalRiceContainers} Boxes</span>
                </div>
                <div className="space-y-1">
                  {metrics.rice.xl > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 font-medium">XL Box</span>
                      <span className="font-bold text-gray-900">{metrics.rice.xl}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium">LG Box</span>
                    <span className="font-bold text-gray-900">{metrics.rice.lg}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium">RG Box</span>
                    <span className="font-bold text-gray-900">{metrics.rice.rg}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2 mt-2 border-t border-gray-100">
              <span className="text-xs font-semibold text-emerald-700">🥗 {metrics.saladCount} Salad</span>
              <span className="text-xs font-semibold text-amber-800">🍮 {metrics.dessertCount} Dessert</span>
            </div>
          </div>

          {/* Card 2: Dal & Sabji (green top accent) */}
          <div className="bg-white rounded-xl shadow-sm p-3 flex flex-col border-x border-b border-[#EEEEEE] border-t-4 border-t-green-500">
            {/* Header: station title only */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">
                🍲 Dal &amp; Sabji
              </span>
            </div>

            {/* Strict 2-column grid (SABJI | DAL) */}
            <div className="grid grid-cols-2 gap-3">
              {/* Left column: SABJI */}
              <div className="min-w-0">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider truncate block">
                  {veg2 ? `SABJI · ${veg2}` : 'SABJI'}
                </span>
                <div className="text-2xl font-black text-emerald-600">
                  {metrics.sabjiOz} oz
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-xs mt-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">LG (12 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.sabjiPackLG}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">RG (8 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.sabjiPackRG}</span>
                  </div>
                </div>
              </div>

              {/* Right column: DAL */}
              <div className="min-w-0">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider truncate block">
                  {veg1 ? `DAL · ${veg1}` : 'DAL'}
                </span>
                <div className="text-2xl font-black text-emerald-600">
                  {metrics.dalOz} oz
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-xs mt-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">LG (12 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.dalPackLG}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">RG (8 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.dalPackRG}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-3 flex flex-col border-x border-b border-[#EEEEEE] border-t-4 border-t-red-500">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11.5px] font-bold text-gray-400 uppercase tracking-wide">🍗 Non-Veg</span>
              <select
                value={nonVeg}
                onChange={(e) => setNonVeg(e.target.value)}
                disabled={isMenuLoading}
                className="text-xs rounded-md border border-gray-200 py-1 px-2 bg-gray-50 focus:bg-white outline-none focus:border-red-400 disabled:opacity-40 disabled:cursor-wait"
              >
                <option value="Chicken Curry">Chicken Curry</option>
                <option value="">None (Veg Day)</option>
              </select>
            </div>
            {isVegDay || metrics.chickenOz === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-gray-200 rounded-lg py-6 px-3">
                <span className="text-[12px] font-bold text-gray-400">🌿 VEG ONLY DAY - Chicken Station Idle</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 items-center">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-red-600 uppercase tracking-wider mb-1">CHICKEN CURRY</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-red-600">{metrics.chickenOz} oz</span>
                    {metrics.chickenLegs > 0 && (
                      <span className="text-sm font-semibold text-red-500 font-sans">({metrics.chickenLegs} legs)</span>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50/80 rounded-lg p-2 border border-gray-100 text-xs space-y-1">
                  <div className="flex justify-between items-center text-gray-600 font-medium">
                    <span>LG (12 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.chickenPackLG}</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-600 font-medium">
                    <span>RG (8 oz)</span>
                    <span className="font-bold text-gray-900">{metrics.chickenPackRG}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* FULL-WIDTH PACKING MANIFEST */}
        <div className="bg-white border border-[#EEEEEE] rounded-xl shadow-sm overflow-hidden w-full print:hidden">
          <div className="px-5 py-3 border-b border-[#F5F5F5] bg-[#FCFCFD] flex justify-between items-center print:hidden">
            <h3 className="text-[12px] font-bold text-[#11142D] uppercase tracking-wide">Kitchen Packing Manifest</h3>
            <button onClick={() => window.print()} className="text-[11.5px] font-bold text-[#5D5FEF] bg-[#F4F4FE] border border-[#EFEEFC] px-3 py-1 rounded-md hover:bg-[#5D5FEF] hover:text-white transition-all">
              🖨️ Print Checklist
            </button>
          </div>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[#A2A4B0] font-bold border-b border-[#F5F5F5] uppercase text-[10.5px] tracking-wider bg-gray-50/60 h-9 break-inside-avoid print:border-slate-300" style={{ pageBreakInside: 'avoid' }}>
                  <th className="hidden print:table-cell w-8 text-center print:py-1 print:px-1.5 print:text-[11px]">[ ]</th>
                  <th className="pl-5 print:py-1 print:px-1.5 print:text-[11px]">Customer</th>
                  <th className="print:table-cell print:py-1 print:px-1.5 print:text-[11px]">Address / Location</th>
                  <th className="print:hidden">Type</th>
                  <th className="print:py-1 print:px-1.5 print:text-[11px]">Portion</th>
                  <th className="print:py-1 print:px-1.5 print:text-[11px]">Breads</th>
                  <th className="print:py-1 print:px-1.5 print:text-[11px]">Rice</th>
                  <th className="pr-5 print:py-1 print:px-1.5 print:text-[11px]">Sabji / Dal / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F6F6F6] print:divide-slate-300">
                {activeCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400 font-medium print:py-1 print:px-1.5 print:text-[11px]">No active kitchen deliveries routed for {activeDay}.</td>
                  </tr>
                ) : (
                  manifestCustomers.map(customer => (
                    <tr
                      key={customer.id}
                      onClick={() => openQuickEdit(customer)}
                      className={`cursor-pointer hover:bg-gray-50/80 transition-colors h-11 break-inside-avoid print:bg-white print:cursor-default ${customer.isSkipped ? 'opacity-60 print:hidden' : ''
                        }`}
                      style={{ pageBreakInside: 'avoid' }}
                    >
                      <td className="hidden print:table-cell w-8 text-center align-middle print:py-1 print:px-1.5 print:text-[11px]">
                        <div className="w-4 h-4 border border-black rounded-sm print:block hidden" />
                      </td>
                      <td className="pl-5 font-bold text-[#11142D] text-[13.5px] print:py-1 print:px-1.5 print:text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`truncate print:whitespace-normal print:overflow-visible ${customer.isSkipped ? 'opacity-50 line-through' : ''}`}>{customer.full_name}</span>
                          {(() => {
                            const scheduledDate = customer.scheduled_cancel_date;
                            if (!scheduledDate) return null;
                            if (scheduledDate === selectedDateKey) {
                              return (
                                <span
                                  title={`Last tiffin day — service ${customer.scheduled_status === 'paused' ? 'pauses' : 'ends'} after today. Collect tiffin bags/boxes or add a goodbye note.`}
                                  className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded whitespace-nowrap"
                                >
                                  LAST DAY
                                </span>
                              );
                            }
                            const daysUntilEnd = daysBetweenKeys(selectedDateKey, scheduledDate);
                            if (daysUntilEnd > 0 && daysUntilEnd <= 3) {
                              return (
                                <span className="shrink-0 text-[10px] text-amber-600 whitespace-nowrap">
                                  Ends {formatShortDate(scheduledDate)}
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </td>
                      <td
                        className="text-xs text-gray-600 max-w-[200px] truncate print:table-cell print:max-w-none print:whitespace-normal print:overflow-visible print:py-1 print:px-1.5 print:text-[11px]"
                        title={customer.delivery_address || ""}
                      >
                        {isPickupOnDay(customer, activeDay) ? (
                          <>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10.5px] font-bold uppercase tracking-wide whitespace-nowrap print:hidden">
                              Pickup
                            </span>
                            <span className="hidden print:inline-block font-black tracking-wider whitespace-nowrap">
                              [PICKUP]
                            </span>
                          </>
                        ) : (
                          customer.delivery_address || "—"
                        )}
                      </td>
                      <td className="print:hidden">
                        <span className={`px-2 py-0.5 rounded text-[10.5px] font-black tracking-wide border uppercase ${customer.meal_type?.toLowerCase().includes('non')
                            ? 'bg-red-50 text-red-600 border-red-100'
                            : 'bg-green-50 text-green-600 border-green-100'
                          }`}>
                          {customer.meal_type?.toLowerCase().includes('non') ? 'Non-Veg' : 'Veg'}
                        </span>
                      </td>
                      <td className="font-bold text-gray-700 uppercase text-[12px] print:py-1 print:px-1.5 print:text-[11px]">
                        {customer.isSkipped ? (
                          <span className="text-gray-300 font-mono">—</span>
                        ) : (
                          <>
                            {formatPortionLabel(customer.portion_size)}
                            <span className="text-[10px] text-gray-400 font-medium ml-1">
                              ({getPortionContainerSpec(customer.portion_size)})
                            </span>
                          </>
                        )}
                      </td>
                      <td className="print:py-1 print:px-1.5 print:text-[11px]">
                        {(() => {
                          if (customer.isSkipped) {
                            return <span className="text-gray-300 font-mono">—</span>;
                          }
                          const hasRoti =
                            typeof customer.roti_count === 'number' && customer.roti_count > 0;
                          const hasPronthi =
                            typeof customer.pronthi_count === 'number' && customer.pronthi_count > 0;
                          if (!hasRoti && !hasPronthi) {
                            return <span className="text-gray-300 font-mono">—</span>;
                          }
                          const breadParts: string[] = [];
                          if (hasRoti) breadParts.push(`${customer.roti_count} Roti`);
                          if (hasPronthi) breadParts.push(`${customer.pronthi_count} Pronthi`);
                          return (
                            <span className="text-[12px] font-bold font-mono text-[#11142D]">
                              {breadParts.join(', ')}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="font-mono text-blue-700 font-bold uppercase text-[12px] print:py-1 print:px-1.5 print:text-[11px]">
                        {customer.isSkipped ? (
                          <span className="text-gray-300 font-mono">—</span>
                        ) : hasRiceToPack(customer.rice_count) ? (
                          customer.rice_count
                        ) : (
                          <span className="text-gray-300 font-mono">—</span>
                        )}
                      </td>
                      <td className="pr-5 print:py-1 print:px-1.5 print:text-[11px]">
                        {(() => {
                          if (customer.isSkipped) {
                            return (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 text-[10.5px] font-black tracking-wide uppercase whitespace-nowrap">
                                  ⏸️ SKIPPED
                                </span>
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation();
                                    handleToggleSkip(customer.id, false);
                                  }}
                                  disabled={isSkipPending}
                                  className="px-2 py-0.5 rounded-md border border-amber-300 bg-white text-amber-800 text-[10.5px] font-black tracking-wide hover:bg-amber-50 transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
                                >
                                  ↩️ Undo
                                </button>
                              </div>
                            );
                          }

                          const activeOverride = dailyOverrides[customer.id];
                          const baseRow = baseCustomerById.get(customer.id);
                          const todayDeviation =
                            activeOverride && baseRow && overrideHasMealSnapshot(activeOverride)
                              ? describeTodayOverride(baseRow, activeOverride)
                              : null;
                          const hasTodayOverride =
                            todayDeviation !== null && todayDeviation !== 'one-time change';
                          const todayOverrideLabel = hasTodayOverride
                            ? `⚡ Today: ${todayDeviation}`
                            : null;

                          const customInstruction = hasTodayOverride
                            ? null
                            : getCustomInstructionsText(customer);

                          const sideInstruction = (customer.delivery_instructions || '').trim();
                          const hasSideInstruction =
                            sideInstruction !== '' &&
                            sideInstruction !== 'None' &&
                            sideInstruction !== '—';

                          const strippedSideInstruction = hasSideInstruction
                            ? stripStandardMealText(sideInstruction)
                            : '';
                          const sideText = customInstruction || hasTodayOverride
                            ? null
                            : strippedSideInstruction !== ''
                              ? strippedSideInstruction
                              : null;

                          const rawNotes = [
                            customer.dietary_notes,
                            customer.notes,
                            customer.side_notes,
                            customer.custom_instructions,
                          ].filter(
                            (v): v is string =>
                              typeof v === 'string' &&
                              v.trim() !== '' &&
                              v.trim() !== '—' &&
                              v.trim() !== 'None'
                          );
                          const noteText =
                            rawNotes.length > 0
                              ? [...new Set(rawNotes.map(v => v.trim()))].join(' · ')
                              : null;

                          const customLabel = customInstruction ? `⚡ ${customInstruction}` : null;

                          const sideAddons = resolveSideAddons(customer);
                          const portion = (customer.portion_size || '').toLowerCase();
                          const isLg = portion.includes('lg') || portion.includes('large');

                          const isDefaultSides = isLg
                            ? sideAddons.salad === 1 && sideAddons.dessert === 1
                            : sideAddons.salad === 0 && sideAddons.dessert === 0;

                          const sidesBadge = isDefaultSides
                            ? '—'
                            : formatSidesBadge(sideAddons.salad, sideAddons.dessert);

                          if (
                            !sideText &&
                            !customLabel &&
                            !noteText &&
                            !todayOverrideLabel &&
                            sidesBadge === '—'
                          ) {
                            return <span className="text-gray-300">—</span>;
                          }

                          return (
                            <div className="flex flex-col items-start gap-1 min-w-0 max-w-[320px] print:max-w-none">
                              {todayOverrideLabel && (
                                <span
                                  className="max-w-full truncate inline-block px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-md text-[10.5px] font-black leading-snug shadow-sm print:whitespace-normal print:overflow-visible print:bg-transparent print:border-0 print:rounded-none print:shadow-none print:px-0 print:py-0"
                                  title={todayOverrideLabel}
                                >
                                  {todayOverrideLabel}
                                </span>
                              )}
                              {customLabel && (
                                <span
                                  className="max-w-full truncate inline-block px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-[10.5px] font-bold leading-snug print:whitespace-normal print:overflow-visible print:bg-transparent print:border-0 print:rounded-none print:shadow-none print:px-0 print:py-0"
                                  title={customLabel}
                                >
                                  {customLabel}
                                </span>
                              )}
                              {sideText && (
                                <span
                                  className="max-w-full truncate inline-block px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md text-[10.5px] font-bold leading-snug print:whitespace-normal print:overflow-visible print:bg-transparent print:border-0 print:rounded-none print:shadow-none print:px-0 print:py-0"
                                  title={sideText}
                                >
                                  {sideText}
                                </span>
                              )}
                              {sidesBadge !== '—' && !sideText && (
                                <span
                                  className="max-w-full truncate inline-block px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-[10.5px] font-bold leading-snug print:whitespace-normal print:overflow-visible print:bg-transparent print:border-0 print:rounded-none print:shadow-none print:px-0 print:py-0"
                                  title={`Sides: ${sidesBadge}`}
                                >
                                  🥗 SIDES {sidesBadge}
                                </span>
                              )}
                              {noteText && (
                                <span
                                  className="max-w-full truncate inline-block px-2 py-0.5 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md text-[10.5px] font-medium leading-snug print:whitespace-normal print:overflow-visible print:bg-transparent print:border-0 print:rounded-none print:shadow-none print:px-0 print:py-0"
                                  title={noteText}
                                >
                                  ⚠️ {noteText}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {quickEditCustomer && (
        <PrepQuickEditSheet
          key={`${quickEditCustomer.id}:${quickEditResetToken}`}
          customer={quickEditCustomer}
          saving={isQuickSaving}
          error={quickSaveError}
          onClose={closeQuickEdit}
          onSave={handleQuickSave}
          overrideDate={selectedDateKey}
          overrideDateLabel={selectedDateFormatted}
          isOverrideActive={
            quickEditCustomer
              ? Boolean(
                dailyOverrides[quickEditCustomer.id] &&
                overrideHasMealSnapshot(dailyOverrides[quickEditCustomer.id])
              )
              : false
          }
          isSkipped={dailyOverrides[quickEditCustomer.id]?.is_skipped === true}
          vacationPending={isVacationPending}
          onCancelVacationPause={() => handleCancelVacationPause(quickEditCustomer.id)}
          hasDayOverride={Boolean(dailyOverrides[quickEditCustomer.id])}
          onClearOverride={handleClearOverride}
        />
      )}
    </div>
  );
}