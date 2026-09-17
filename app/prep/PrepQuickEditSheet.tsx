'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Zap, Calendar, RefreshCw, X, AlertTriangle, Info, CalendarOff, Clock, Undo2, Pause, Trash2, Check } from 'lucide-react';
import type { MealConfigPayload } from '@/app/admin/actions';
import { parseActiveScheduleDays } from '@/app/utils/customerPickup';
import { renewCustomerSubscription, endCustomerSubscription } from './actions';
import { useRouter } from 'next/navigation';

// Minimal view of a manifest row — only the fields the quick sheet edits/reads.
type QuickCustomer = {
  id: string;
  full_name: string;
  meal_type?: string | null;
  dietary_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  dietary_notes?: string | null;
  subscription_status?: string | null;
  delivery_instructions?: string | null;
  delivery_schedule?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  start_date?: string | null;
  total_credits?: number | null;
  total_tiffin_credits?: number | null;
  plan_tier?: string | null;
  notes?: string | null;
  cycle_end_date?: string | null;
  scheduled_cancel_date?: string | null;
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
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG;
  return PORTION_RG;
};

const isNonVeg = (value: string | null | undefined): boolean =>
  String(value || '').toLowerCase().includes('non');

const DEFAULT_ROTI_COUNT = 8;
const DEFAULT_PRONTHI_COUNT = 0;

const resolveDietarySource = (customer: QuickCustomer): string | null | undefined =>
  customer.meal_type || customer.dietary_type;

const resolveDietaryType = (customer: QuickCustomer): 'Veg' | 'Non-veg' =>
  isNonVeg(resolveDietarySource(customer)) ? 'Non-veg' : 'Veg';

const resolvePortion = (customer: QuickCustomer): string =>
  normalizePortion(customer.portion_size || PORTION_LG);

const resolveNotes = (customer: QuickCustomer): string =>
  customer.dietary_notes || customer.delivery_instructions || '';

type RiceCounts = { rg: number; lg: number; xl: number };
const ZERO_RICE: RiceCounts = { rg: 0, lg: 0, xl: 0 };

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

const isHalfPortionToken = (token: string): boolean =>
  String(token || '').trim().toUpperCase().startsWith('HALF');

type CurryCounts = { dal: number; sabji: number; chicken: number; gravy: number };
const ZERO_CURRY: CurryCounts = { dal: 0, sabji: 0, chicken: 0, gravy: 0 };

const DEFAULT_MWF_COUNTS: CurryCounts = { dal: 0, sabji: 1, chicken: 1, gravy: 0 };
const DEFAULT_TTH_COUNTS: CurryCounts = { dal: 1, sabji: 1, chicken: 0, gravy: 0 };

const curryCountsEqual = (a: CurryCounts, b: CurryCounts): boolean =>
  a.dal === b.dal && a.sabji === b.sabji && a.chicken === b.chicken && a.gravy === b.gravy;

const hasAnyCurryCount = (c: CurryCounts): boolean =>
  c.dal > 0 || c.sabji > 0 || c.chicken > 0 || c.gravy > 0;

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

const getStoredCurryCounts = (customer: QuickCustomer): CurryCounts => {
  const storedDiet: 'Veg' | 'Non-veg' = resolveDietaryType(customer);
  const storedPortion = resolvePortion(customer);
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) return structured.mwf;
  const parsed = parseCurryCounts(customer.delivery_instructions);
  if (hasAnyCurryCount(parsed)) return parsed;
  return defaultCurryCounts(storedDiet, storedPortion);
};

const getStoredTthCounts = (customer: QuickCustomer): CurryCounts => {
  const structured = parseStructuredCurryConfig(customer.curry_config);
  if (structured) return structured.tth;
  return { ...DEFAULT_TTH_COUNTS };
};

const formatAddonCount = (count: number, label: string): string =>
  count > 1 ? `${count}x ${label}` : label;

const FRIDAY_DOUBLE_PACK_NOTE = '[NOTE: Pack 2 Tiffins on Friday for Saturday meal]';

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

const toDateInputKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateInputKey = (key: string): Date | null => {
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addCalendarDays = (key: string, days: number): string => {
  const date = parseDateInputKey(key);
  if (!date) return key;
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return toDateInputKey(next);
};

const SCHEDULE_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const DEFAULT_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const countDeliveryDaysInRange = (
  start: string,
  end: string,
  schedule: string | null | undefined
): number => {
  const startDate = parseDateInputKey(start);
  const endDate = parseDateInputKey(end);
  if (!startDate || !endDate || startDate > endDate) return 0;

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

export type QuickEditScope = 'today' | 'range' | 'permanent';

export type QuickEditSaveRequest = {
  scope: QuickEditScope;
  startDate: string;
  endDate: string;
  isSkipped: boolean;
  config: MealConfigPayload;
};

const APPLY_SCOPE_OPTIONS: {
  key: QuickEditScope;
  icon: React.ReactNode;
  label: string;
  sub: string;
  title: string;
}[] = [
    {
      key: 'today',
      icon: <Zap className="w-5 h-5" />,
      label: 'Today Only',
      sub: 'Single day',
      title: 'Apply to this manifest date only',
    },
    {
      key: 'range',
      icon: <Calendar className="w-5 h-5" />,
      label: 'Date Range',
      sub: 'Multi-day',
      title: 'Apply to every delivery day in a date window',
    },
    {
      key: 'permanent',
      icon: <RefreshCw className="w-5 h-5" />,
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
  overrideDate: string;
  overrideDateLabel: string;
  isOverrideActive?: boolean;
  isSkipped?: boolean;
  hasDayOverride?: boolean;
  onClearOverride?: () => void;
  onCancelVacationPause?: () => void;
  vacationPending?: boolean;
  isExpiredPendingRenewal?: boolean;
  expiredOnDate?: string;
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
  isExpiredPendingRenewal = false,
  expiredOnDate,
}: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [scope, setScope] = useState<QuickEditScope>('today');
  const [draftSkipped, setDraftSkipped] = useState<boolean>(isSkipped);
  const [rangeStart, setRangeStart] = useState<string>(overrideDate);
  const [rangeEnd, setRangeEnd] = useState<string>(() => addCalendarDays(overrideDate, 2));
  const [formError, setFormError] = useState<string | null>(null);

  // Renewal transition and draft day state (inside component body)
  // Renewal transition and draft day state (inside component body)
  const [isRenewing, startRenewTransition] = useTransition();
  const [isEndingSub, startEndSubTransition] = useTransition();
  const [renewError, setRenewError] = useState<string | null>(null);
  const [daysToAdd, setDaysToAdd] = useState<number>(5);

  const [mealType, setMealType] = useState<'Veg' | 'Non-veg'>(() =>
    resolveDietaryType(customer)
  );
  const [portion, setPortion] = useState<string>(() => resolvePortion(customer));
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

  const skipActive = draftSkipped;
  const rangeInvalid = !rangeStart || !rangeEnd || rangeStart > rangeEnd;
  const rangeDays = rangeInvalid
    ? 0
    : countDeliveryDaysInRange(rangeStart, rangeEnd, customer.delivery_schedule);

  // Check if today is the customer's last delivery day
  const isCustomerLastDay = React.useMemo(() => {
    const normalizedSelected = overrideDate.slice(0, 10);
    const scheduledDate = customer.scheduled_cancel_date;
    const explicitEnd = customer.cycle_end_date?.slice(0, 10);
    if (explicitEnd === normalizedSelected || scheduledDate === overrideDate) {
      return true;
    }
    if (!customer.start_date) return false;

    let totalMeals =
      typeof customer.total_tiffin_credits === 'number' && customer.total_tiffin_credits > 0
        ? customer.total_tiffin_credits
        : typeof customer.total_credits === 'number' && customer.total_credits > 0
          ? customer.total_credits
          : 0;

    if (!totalMeals) {
      const combinedInfo = `${customer.plan_tier || ''} ${customer.notes || ''} ${customer.delivery_schedule || ''}`.toLowerCase();
      if (combinedInfo.includes('month') || combinedInfo.includes('20')) {
        totalMeals = 20;
      } else if (combinedInfo.includes('trial') || combinedInfo.includes('1')) {
        totalMeals = 1;
      } else {
        totalMeals = 5;
      }
    }

    const start = new Date(`${customer.start_date.slice(0, 10)}T00:00:00`);
    if (isNaN(start.getTime())) return false;
    let counted = start.getDay() !== 0 && start.getDay() !== 6 ? 1 : 0;
    const cursor = new Date(start);
    while (counted < totalMeals) {
      cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) counted++;
      if (counted > 730) return false;
    }
    const computedStr = toDateInputKey(cursor);
    return computedStr === normalizedSelected;
  }, [customer, overrideDate]);

  const handleRenewSubscription = (creditsToAdd: number, planTier?: 'trial' | 'weekly' | 'monthly') => {
    setRenewError(null);
    startRenewTransition(async () => {
      const res = await renewCustomerSubscription({
        customerId: customer.id,
        creditsToAdd,
        planTier,
      });
      if (res.success) {
        router.refresh();
        onClose();
      } else {
        setRenewError(res.message || 'Failed to extend subscription.');
      }
    });
  };

  const handleScopeChange = (next: QuickEditScope) => {
    setScope(next);
    setFormError(null);
    if (next === 'permanent') setDraftSkipped(false);
  };

  const handleMealTypeChange = (next: 'Veg' | 'Non-veg') => {
    if (next === mealType) return;
    setMealType(next);
    setCurry(defaultCurryCounts(next, portion));
  };

  const handlePortionChange = (next: string) => {
    if (next === portion) return;
    setPortion(next);
    setCurry(defaultCurryCounts(mealType, next));
  };

  const handleCurryPillChange = (counts: CurryCounts) => setCurry(counts);

  const handleSave = () => {
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

    const skipChanged = draftSkipped !== isSkipped;
    const hasWork = hasDiff || skipChanged;

    if (scope !== 'permanent' && !hasWork) {
      onClose();
      return;
    }
    if (scope === 'permanent' && !hasDiff && !isOverrideActive) {
      onClose();
      return;
    }

    const permanentConfig = hasDiff || !isOverrideActive ? diffConfig : snapshot;
    const applyToday = scope === 'today';

    setFormError(null);
    onSave({
      scope,
      startDate: applyToday ? overrideDate : rangeStart,
      endDate: applyToday ? overrideDate : rangeEnd,
      isSkipped: scope === 'permanent' ? false : draftSkipped,
      config: applyToday ? snapshot : scope === 'range' ? snapshot : permanentConfig,
    });
  };

  const portionLabel = (() => {
    if (portion === PORTION_LG) return 'LG';
    if (portion === PORTION_HALF_LG) return 'HALF LG';
    if (portion === PORTION_HALF_RG) return 'HALF RG';
    return 'RG';
  })();

  const halfCurryHint = isNonVegDraft ? '1 Chicken' : '1 Dal';

  const pauseStart = customer.pause_start_date ?? null;
  const pauseEnd = customer.pause_end_date ?? null;
  const isOnVacation =
    Boolean(pauseStart) && overrideDate >= (pauseStart as string) && (!pauseEnd || overrideDate < pauseEnd);

  const shouldShowRenewalCard = isCustomerLastDay || isExpiredPendingRenewal;
  const handleEndSubscription = () => {
    if (!customer) return;
    const confirmed = window.confirm(
      `End subscription for ${customer.full_name}? They will be marked as cancelled and moved to the lapsed list.`
    );
    if (!confirmed) return;

    startEndSubTransition(async () => {
      try {
        const res = await endCustomerSubscription(customer.id);
        if (res.success) {
          onClose();
          router.refresh();
        } else {
          alert(`Could not end subscription: ${res.message || 'Unknown database error'}`);
        }
      } catch (e: any) {
        alert(`Error: ${e?.message || 'Failed to communicate with server'}`);
      }
    });
  };
  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className={`absolute inset-0 bg-[#11142D]/45 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'
          }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit meal config for ${customer.full_name}`}
        className={`absolute inset-x-0 bottom-0 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:left-auto w-full sm:w-[440px] sm:max-w-[92vw] max-h-[88vh] sm:max-h-none flex flex-col bg-white rounded-t-3xl sm:rounded-t-none sm:rounded-l-2xl shadow-2xl transition-transform duration-300 ease-out will-change-transform ${visible
          ? 'translate-y-0 sm:translate-y-0 sm:translate-x-0'
          : 'translate-y-full sm:translate-y-0 sm:translate-x-full'
          }`}
      >
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-3 border-b border-[#F0F0F2] shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-black text-[#11142D] truncate">{customer.full_name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-black tracking-wide uppercase border ${mealType === 'Non-veg'
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
          {(error || formError || renewError) && (
            <div className="px-3.5 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 text-[13px] font-semibold rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>{error || formError || renewError}</span>
            </div>
          )}

          {/* RENEWAL / EXTENSION CARD WITH STEPPER AND CONFIRM BUTTON */}
          {shouldShowRenewalCard && (
            <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-3.5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">{isCustomerLastDay ? <AlertTriangle className="w-4 h-4 text-rose-500" /> : <Clock className="w-4 h-4 text-amber-500" />}</span>
                <div>
                  <h4 className="text-[13px] font-black text-amber-900 leading-tight">
                    {isCustomerLastDay ? 'Final Delivery Day Today' : 'Subscription Ended (Renewal Pending)'}
                  </h4>
                  <p className="text-[11px] font-medium text-amber-800">
                    {isCustomerLastDay
                      ? 'Cycle finishes today. Choose days to add and confirm below.'
                      : `Plan completed on ${expiredOnDate || 'previous delivery'}. Select days to resume.`}
                  </p>
                </div>
              </div>

              {/* Quick-fill Presets (Updates selection without auto-saving) */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDaysToAdd(5)}
                  className={`h-10 rounded-lg font-bold text-[12px] flex flex-col items-center justify-center transition-all border ${daysToAdd === 5
                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                    : 'bg-white border-amber-300 text-amber-950 hover:bg-amber-100'
                    }`}
                >
                  <span>+ 1 Week</span>
                  <span className={`text-[9.5px] ${daysToAdd === 5 ? 'text-amber-100' : 'opacity-70'}`}>5 Meals</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDaysToAdd(20)}
                  className={`h-10 rounded-lg font-bold text-[12px] flex flex-col items-center justify-center transition-all border ${daysToAdd === 20
                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                    : 'bg-white border-amber-300 text-amber-950 hover:bg-amber-100'
                    }`}
                >
                  <span>+ 1 Month</span>
                  <span className={`text-[9.5px] ${daysToAdd === 20 ? 'text-amber-100' : 'opacity-70'}`}>20 Meals</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDaysToAdd(1)}
                  className={`h-10 rounded-lg font-bold text-[12px] flex flex-col items-center justify-center transition-all border ${daysToAdd === 1
                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                    : 'bg-white border-amber-300 text-amber-950 hover:bg-amber-100'
                    }`}
                >
                  <span>+ 1 Day</span>
                  <span className={`text-[9.5px] ${daysToAdd === 1 ? 'text-amber-100' : 'opacity-70'}`}>1 Meal</span>
                </button>
              </div>

              {/* Precise Stepper Input (- / input / +) */}
              <div className="flex items-center justify-between pt-1 border-t border-amber-200 gap-3">
                <span className="text-[11.5px] font-bold text-amber-900 shrink-0">
                  Days / Credits to Add:
                </span>
                <div className="flex items-center h-9 rounded-lg border border-amber-300 bg-white overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setDaysToAdd(prev => Math.max(1, prev - 1))}
                    disabled={daysToAdd <= 1 || isRenewing}
                    className="w-8 h-full bg-amber-50 hover:bg-amber-100 text-amber-900 font-black text-base flex items-center justify-center transition-colors disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={daysToAdd}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10);
                      setDaysToAdd(Number.isNaN(val) ? 1 : Math.max(1, val));
                    }}
                    className="w-12 h-full text-center font-black text-sm text-amber-950 outline-none border-x border-amber-200 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDaysToAdd(prev => prev + 1)}
                    disabled={isRenewing}
                    className="w-8 h-full bg-amber-50 hover:bg-amber-100 text-amber-900 font-black text-base flex items-center justify-center transition-colors disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Explicit Confirmation Action */}
              <button
                type="button"
                disabled={isRenewing || daysToAdd < 1}
                onClick={() => {
                  const planTier = daysToAdd >= 20 ? 'monthly' : daysToAdd > 1 ? 'weekly' : 'trial';
                  handleRenewSubscription(daysToAdd, planTier);
                }}
                className="w-full h-10 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[13px] shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {isRenewing ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Adding {daysToAdd} {daysToAdd === 1 ? 'Day' : 'Days'}…
                  </>
                ) : (
                  `Confirm Extension (+${daysToAdd} ${daysToAdd === 1 ? 'Day' : 'Days'})`
                )}
              </button>

              {/* EXIT PATH: NOT RENEWING */}
              <div className="pt-2 border-t border-amber-200/60 flex flex-col items-center">
                <button
                  type="button"
                  disabled={isEndingSub || saving}
                  onClick={handleEndSubscription}
                  className="w-full py-2 px-3 text-xs font-bold text-gray-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  {isEndingSub ? 'Archiving…' : <span className="flex items-center gap-1"><X className="w-3.5 h-3.5" /> Customer Not Renewing? End Subscription & Archive</span>}
                </button>
              </div>

            </div>
          )}

          {/* Vacation banner */}
          {isOnVacation && (
            <div className="bg-sky-50 border border-sky-200 text-sky-900 rounded-lg p-3 mb-4">
              <p className="text-[13px] font-bold">
                <CalendarOff className="w-4 h-4" /> Customer on Vacation ({pauseStart} to {pauseEnd || 'Indefinite'})
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
                <Undo2 className="w-4 h-4" /> Cancel Vacation &amp; Resume Meals
              </button>
            </div>
          )}

          {/* Skip action */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setDraftSkipped(prev => !prev);
                setFormError(null);
              }}
              disabled={saving || scope === 'permanent'}
              className={`w-full h-11 rounded-xl font-bold transition-colors text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${skipActive
                ? 'bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200'
                : 'bg-white border border-gray-300 text-[#292D32] hover:bg-gray-50'
                }`}
            >
              {skipActive ? <span className="flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" /> Undo Skip</span> : <span className="flex items-center gap-1"><Pause className="w-3.5 h-3.5" /> Skip Delivery</span>}
            </button>
            <p className="mt-1.5 text-[11px] text-gray-400 font-medium text-center">
              {scope === 'permanent'
                ? 'Skips need a Today Only or Date Range scope.'
                : skipActive
                  ? 'Skips the delivery days chosen below & extends the billing cycle.'
                  : 'Marks the delivery days chosen below as skipped.'}
            </p>
          </div>

          <div
            inert={skipActive}
            aria-hidden={skipActive || undefined}
            className={`space-y-5 overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${skipActive ? 'max-h-0 opacity-0' : 'max-h-[1600px] opacity-100'
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
                    className={`h-11 rounded-xl border text-base transition-colors ${mealType === opt.key ? opt.active : opt.inactive
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
                    className={`h-11 rounded-xl border text-base transition-colors ${portion === opt.value
                      ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] font-bold shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 font-semibold'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Curry selector */}
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
                        className={`h-9 px-3 rounded-xl border text-[13px] font-bold transition-colors ${active
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
                      className={`h-11 px-4 rounded-xl border text-sm font-bold transition-colors ${active
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

        {/* Footer */}
        <div className="px-5 py-4 shrink-0 bg-white space-y-3 border-t border-[#F0F0F2] overflow-y-auto max-h-[62vh]">
          {hasDayOverride && onClearOverride && (
            <button
              type="button"
              onClick={onClearOverride}
              disabled={saving}
              className="w-full h-11 bg-white border border-rose-200 text-rose-600 font-bold rounded-xl hover:bg-rose-50 active:bg-rose-100 transition-colors text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" /> Reset to Master Profile
            </button>
          )}

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
                    className={`min-h-[64px] px-2 py-2 rounded-xl border text-[12px] font-bold transition-colors flex flex-col items-center justify-center gap-1 text-center ${active
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
                  className={`text-[12px] font-semibold rounded-lg px-3 py-2 border ${rangeInvalid || rangeDays === 0
                    ? 'text-rose-600 bg-rose-50 border-rose-200'
                    : 'text-[#5D5FEF] bg-[#5D5FEF]/5 border border-[#5D5FEF]/20'
                    }`}
                >
                  {rangeInvalid
                    ? <span className="flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-rose-500" /> Pick an end date on or after the start date.</span>
                    : <span className="flex items-center gap-1"><Info className="w-4 h-4 text-[#5D5FEF]" /> Applies to {rangeDays} delivery {rangeDays === 1 ? 'day' : 'days'}, then reverts automatically.</span>}
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