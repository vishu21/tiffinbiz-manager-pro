'use client';

import React, { useState, useTransition, useEffect, useRef, useSyncExternalStore } from 'react';
import { createCustomer, updateCustomer, deleteCustomer, pauseCustomer, cancelCustomer, resumeCustomer, reactivateCustomer, updateCancellationDetails, searchAddress } from '@/app/admin/actions';

// Stable no-op subscription for the mount flag below.
const noopSubscribe = () => () => {};

// Plan tier options + included credits.
const PLAN_OPTIONS: { key: 'trial' | 'weekly' | 'monthly'; label: string; credits: number }[] = [
  { key: 'trial', label: 'Trial', credits: 1 },
  { key: 'weekly', label: 'Weekly', credits: 5 },
  { key: 'monthly', label: 'Monthly', credits: 20 },
];
const TIER_BADGE_STYLES: Record<string, string> = {
  trial: 'bg-sky-50 text-sky-700 border-sky-200',
  weekly: 'bg-blue-50 text-blue-700 border-blue-200',
  monthly: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};
const formatStartDateLabel = (value: string | null | undefined): string => {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

type Customer = {
  id: string;
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  meal_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  delivery_schedule?: string | null;
  subscription_status?: string | null;
  plan_tier?: 'trial' | 'weekly' | 'monthly' | null;
  total_tiffin_credits?: number | null;
  start_date?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  created_at: string;
};

type SideCounts = {
  dal: number;
  sabji: number;
  gravy: number;
  chicken: number;
  salad: number;
  dessert: number;
};

// Canonical portion tokens used across the dashboard:
//   RG / LG           → full plans (2 containers/day)
//   Half RG / Half LG → single-container plans (1 container/day)
const PORTION_RG = 'RG';
const PORTION_LG = 'LG';
const PORTION_HALF_RG = 'Half RG';
const PORTION_HALF_LG = 'Half LG';

const normalizePortionToken = (value: string | null | undefined): string => {
  const v = (value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (v.startsWith('HALF')) {
    return v.includes('LG') || v.includes('LARGE') ? PORTION_HALF_LG : PORTION_HALF_RG;
  }
  if (v === 'LG' || v === 'LARGE') return PORTION_LG;
  if (v === 'SM' || v === 'SMALL') return PORTION_HALF_RG; // legacy 1x 8oz
  return PORTION_RG; // RG / REGULAR / empty → full regular
};

const isHalfPortion = (value: string | null | undefined): boolean => {
  const p = normalizePortionToken(value);
  return p === PORTION_HALF_RG || p === PORTION_HALF_LG;
};

// Formats an add-on count (e.g. "Salad", "2x Salad", "3x Dessert").
const formatSideAddon = (count: number, label: string): string =>
  count > 1 ? `${count}x ${label}` : label;

// Human-readable summary of a curry/side allocation (e.g. "1 Dal + 1 Sabji + Salad").
const formatSideSummary = (counts: SideCounts): string => {
  const parts: string[] = [];
  if (counts.dal > 0) parts.push(`${counts.dal} Dal`);
  if (counts.sabji > 0) parts.push(`${counts.sabji} Sabji`);
  if (counts.gravy > 0) parts.push(`${counts.gravy} Gravy`);
  if (counts.chicken > 0) parts.push(`${counts.chicken} Chicken`);
  let summary = parts.join(' + ');
  if (counts.salad > 0) summary += ` + ${formatSideAddon(counts.salad, 'Salad')}`;
  if (counts.dessert > 0) summary += ` + ${formatSideAddon(counts.dessert, 'Dessert')}`;
  return summary;
};

// "⚡ Custom: …" summary for single-container Half RG / Half LG plans.
//   Half LG explicitly accounts for both add-ons ("No Salad" / "No Dessert" when off).
//   Half RG only lists add-ons when opted in.
const formatHalfContainerNote = (
  counts: SideCounts,
  portion: string | null | undefined
): string => {
  const parts: string[] = [];
  if (counts.dal > 0) parts.push(`${counts.dal} Dal`);
  if (counts.sabji > 0) parts.push(`${counts.sabji} Sabji`);
  if (counts.gravy > 0) parts.push(`${counts.gravy} Gravy`);
  if (counts.chicken > 0) parts.push(`${counts.chicken} Chicken`);

  const selectedItem = parts.join(' + ') || '1 Container';
  const isHalfLg = normalizePortionToken(portion) === PORTION_HALF_LG;
  const isHalfRg = normalizePortionToken(portion) === PORTION_HALF_RG;

  const noteParts: string[] = [selectedItem];
  if (isHalfLg) {
    noteParts.push(counts.salad > 0 ? formatSideAddon(counts.salad, 'Salad') : 'No Salad');
    noteParts.push(counts.dessert > 0 ? formatSideAddon(counts.dessert, 'Dessert') : 'No Dessert');
  } else if (isHalfRg) {
    if (counts.salad > 0) noteParts.push(formatSideAddon(counts.salad, 'Salad'));
    if (counts.dessert > 0) noteParts.push(formatSideAddon(counts.dessert, 'Dessert'));
  }

  return `Custom: ${noteParts.join(' + ')}`;
};

// The built-in "standard" curry profile for a meal type + portion.
const defaultSideCounts = (mealType: string, portion: string): SideCounts => {
  const isNonVeg = mealType === 'Non-veg';
  const p = normalizePortionToken(portion);
  if (isHalfPortion(p)) {
    // Half plans = exactly 1 container/day (Veg default: 1 Dal; Non-Veg default: 1 Chicken).
    return isNonVeg
      ? { dal: 0, sabji: 0, gravy: 0, chicken: 1, salad: 0, dessert: 0 }
      : { dal: 1, sabji: 0, gravy: 0, chicken: 0, salad: 0, dessert: 0 };
  }
  if (isNonVeg) {
    // Standard non-veg → 1 Sabji + 1 Chicken on M/W/F
    // (Veg sabji Tue/Thu + 1 Dal is handled automatically by the prep calendar routing).
    return {
      dal: 0,
      sabji: 1,
      gravy: 0,
      chicken: 1,
      salad: p === PORTION_LG ? 1 : 0,
      dessert: p === PORTION_LG ? 1 : 0,
    };
  }
  return {
    dal: 1,
    sabji: 1,
    gravy: 0,
    chicken: 0,
    salad: p === PORTION_LG ? 1 : 0,
    dessert: p === PORTION_LG ? 1 : 0,
  };
};

const curryFieldsEqual = (a: SideCounts, b: SideCounts): boolean =>
  a.dal === b.dal &&
  a.sabji === b.sabji &&
  a.gravy === b.gravy &&
  a.chicken === b.chicken;

// Curry-only deviation check: Salad / Dessert counts NEVER affect curry preset detection.
const deviatesCurryFromDefault = (mealType: string, portion: string, counts: SideCounts): boolean =>
  !curryFieldsEqual(counts, defaultSideCounts(mealType, portion));

// ── Structured weekly curry configuration (stored in the `curry_config` TEXT column) ──
// All container allotments are day-grouped: Mon/Wed/Fri (non-veg days) + Tue/Thu (veg days).
type DayCurryProfile = {
  dal: number;
  chicken: number;
  sabji: number;
  gravy?: number; // defaulted to 0 when absent (backwards compatible)
};

type WeeklyCurryConfig = {
  pattern_type: 'non_veg_rotation' | 'veg_fixed';
  mwf: DayCurryProfile;
  tth: DayCurryProfile;
  extras: string[];
};

const DEFAULT_MWF_PROFILE: DayCurryProfile = { dal: 0, sabji: 1, chicken: 1, gravy: 0 };
const DEFAULT_TTH_PROFILE: DayCurryProfile = { dal: 1, chicken: 0, sabji: 1, gravy: 0 };
const DOUBLE_DAL_TTH_PROFILE: DayCurryProfile = { dal: 2, chicken: 0, sabji: 0, gravy: 0 };

// Standard Mon–Fri delivery set. Stored comma-separated: 'Mon,Tue,Wed,Thu,Fri'.
const WEEKDAY_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DEFAULT_DELIVERY_SCHEDULE = 'Mon,Tue,Wed,Thu,Fri';

// Multi-channel contact support stored inside the existing `phone_number` column:
//   - Phone      → plain value (e.g. "+1 (226) 555-0199")
//   - Messenger  → "FB: <profile name or m.me link>"
//   - WhatsApp   → "WA: <number>"
type ContactChannel = 'phone' | 'messenger' | 'whatsapp';

const parseStoredContact = (
  raw: string | null | undefined
): { channel: ContactChannel; value: string } => {
  const value = (raw || '').trim();
  if (/^FB:/i.test(value)) {
    return { channel: 'messenger', value: value.replace(/^FB:\s*/i, '').trim() };
  }
  if (/^WA:/i.test(value)) {
    return { channel: 'whatsapp', value: value.replace(/^WA:\s*/i, '').trim() };
  }
  return { channel: 'phone', value };
};

const formatContactValue = (channel: ContactChannel, rawValue: string): string => {
  const value = rawValue.trim();
  if (!value) return '';
  if (channel === 'messenger') return `FB: ${value}`;
  if (channel === 'whatsapp') return `WA: ${value}`;
  return value;
};

// Kitchen Dispatch / Packing Order hierarchy:
//   1. Dietary type — Non-Veg first, then Veg (unknown last)
//   2. Portion size — Large → Regular → Small (unknown last)
//   3. Alphabetical by full_name as a clean tie-breaker
const getDietaryRank = (mealType: string | null | undefined): number => {
  const t = String(mealType || '').toLowerCase();
  if (t.includes('non')) return 1; // Non-Veg first
  if (t.includes('veg')) return 2; // Veg second
  return 3;
};

const getSizeRank = (portionSize: string | null | undefined): number => {
  // Packing order: Full LG → Half LG → Full RG → Half RG (unknown last).
  const p = normalizePortionToken(portionSize);
  if (p === PORTION_LG) return 1;
  if (p === PORTION_HALF_LG) return 2;
  if (p === PORTION_RG) return 3;
  if (p === PORTION_HALF_RG) return 4;
  return 5;
};

const kitchenDispatchSort = (a: Customer, b: Customer): number => {
  const dietDiff = getDietaryRank(a.meal_type) - getDietaryRank(b.meal_type);
  if (dietDiff !== 0) return dietDiff;

  const sizeDiff = getSizeRank(a.portion_size) - getSizeRank(b.portion_size);
  if (sizeDiff !== 0) return sizeDiff;

  return (a.full_name || '').localeCompare(b.full_name || '');
};

// Normalizes an old/optional profile so every count is a concrete number (gravy defaults 0).
const normalizeDayProfile = (p: DayCurryProfile): DayCurryProfile => ({
  dal: p.dal || 0,
  chicken: p.chicken || 0,
  sabji: p.sabji || 0,
  gravy: p.gravy || 0,
});

const dayProfilesEqual = (a: DayCurryProfile, b: DayCurryProfile): boolean => {
  const na = normalizeDayProfile(a);
  const nb = normalizeDayProfile(b);
  return (
    na.dal === nb.dal &&
    na.chicken === nb.chicken &&
    na.sabji === nb.sabji &&
    na.gravy === nb.gravy
  );
};

const isDefaultMwf = (profile: DayCurryProfile): boolean =>
  dayProfilesEqual(profile, DEFAULT_MWF_PROFILE);
const isDefaultTTh = (profile: DayCurryProfile): boolean =>
  dayProfilesEqual(profile, DEFAULT_TTH_PROFILE);
const isDoubleDalTTh = (profile: DayCurryProfile): boolean =>
  normalizeDayProfile(profile).dal === 2 &&
  profile.chicken === 0 &&
  profile.sabji === 0 &&
  !(profile.gravy || 0);

// Quick-pill presets for each day group.
const MWF_PRESETS: Record<string, DayCurryProfile> = {
  'default': DEFAULT_MWF_PROFILE, // 1 Sabji + 1 Chicken
  'dal-chicken': { dal: 1, chicken: 1, sabji: 0, gravy: 0 },
  'double-chicken': { dal: 0, chicken: 2, sabji: 0, gravy: 0 },
  'double-gravy': { dal: 0, chicken: 0, sabji: 0, gravy: 2 },
};
const TTH_PRESETS: Record<string, DayCurryProfile> = {
  'default': DEFAULT_TTH_PROFILE,
  'double-dal': DOUBLE_DAL_TTH_PROFILE,
  'double-sabji': { dal: 0, chicken: 0, sabji: 2, gravy: 0 },
};

// Parses a stored `curry_config` value. Structured configs are JSON; legacy values that
// don't start with "{" (plain text summaries) are returned as null.
const parseWeeklyCurryConfig = (raw: string | null | undefined): WeeklyCurryConfig | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as WeeklyCurryConfig & {
      mwf?: Partial<DayCurryProfile>;
      tth?: Partial<DayCurryProfile>;
    };
    if (
      parsed &&
      parsed.mwf &&
      parsed.tth &&
      typeof parsed.mwf.dal === 'number' &&
      typeof parsed.tth.dal === 'number'
    ) {
      return {
        pattern_type:
          parsed.pattern_type === 'veg_fixed' ? 'veg_fixed' : 'non_veg_rotation',
        mwf: normalizeDayProfile(parsed.mwf as DayCurryProfile),
        tth: normalizeDayProfile(parsed.tth as DayCurryProfile),
        extras: Array.isArray(parsed.extras) ? parsed.extras : [],
      };
    }
  } catch {
    // ignore malformed JSON
  }
  return null;
};

// Human text for a single day profile, e.g. "1 Dal + 1 Chicken", "2x Dal", or "2x Gravy".
const formatDayProfile = (profile: DayCurryProfile): string => {
  const p = normalizeDayProfile(profile);
  const gravy = p.gravy || 0;
  const parts: string[] = [];
  if (p.dal > 0) parts.push(p.dal > 1 ? `${p.dal} Dal` : '1 Dal');
  if (p.sabji > 0) parts.push(p.sabji > 1 ? `${p.sabji} Sabji` : '1 Sabji');
  if (p.chicken > 0) parts.push(p.chicken > 1 ? `${p.chicken} Chicken` : '1 Chicken');
  if (gravy > 0) parts.push(gravy > 1 ? `${gravy} Gravy` : '1 Gravy');
  return parts.length > 0 ? parts.join(' + ') : 'No sides';
};

// Short "substitution" phrasing for badges, e.g. "2x Dal", "2x Sabji", "2x Chicken", "2x Gravy".
const describeSubstitution = (profile: DayCurryProfile): string => {
  const p = normalizeDayProfile(profile);
  const gravy = p.gravy || 0;
  const entries: [number, string][] = [
    [p.dal, 'Dal'],
    [p.sabji, 'Sabji'],
    [p.chicken, 'Chicken'],
    [gravy, 'Gravy'],
  ];
  const active = entries.filter(([count]) => count > 0);
  if (active.length === 1 && active[0][0] === 2) return `2x ${active[0][1]}`;
  return formatDayProfile(p);
};

// Builds the "⚡" badge text for a custom weekly curry split by listing only the
// day groups that deviate from their official default (M/W/F: 1 Sabji + 1 Chicken,
// T/Th: 1 Dal + 1 Sabji). Both deviations are joined with " | "; returns null when
// neither group deviates (nothing custom to show).
const formatCustomCurryBadge = (
  mwf: DayCurryProfile,
  tth: DayCurryProfile
): string | null => {
  const mwfText = isDefaultMwf(mwf) ? null : `M/W/F: ${describeSubstitution(mwf)}`;
  const tthText = isDefaultTTh(tth) ? null : `T/Th: ${describeSubstitution(tth)}`;
  if (mwfText && tthText) return `${mwfText} | ${tthText}`;
  return mwfText ?? tthText;
};

// Removes a phrase that is already shown by the amber custom-side badge from a dietary note,
// so the NOTES column never repeats the same text twice. Returns the leftover note (or null
// when nothing meaningful remains).
const dedupeRedundantNote = (customText: string | null, note: string): string | null => {
  if (!customText) return note;
  const lowerNote = note.toLowerCase();
  const lowerCustom = customText.toLowerCase();
  // Only treat the note as a duplicate when it repeats the exact badge phrase.
  if (!lowerNote.includes(lowerCustom)) return note;

  const escaped = lowerCustom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = note
    .split(new RegExp(`(${escaped})`, 'ig'))
    .map(seg => seg.trim())
    .filter(seg => seg !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
};

export default function CustomerSplitLayout({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  // Mounted flag via useSyncExternalStore: SSR + first client paint both read the
  // server snapshot (false); only after hydration does the client snapshot (true) apply.
  const isMounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  const [activeTab, setActiveTab] = useState<'all' | 'veg' | 'non-veg'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Portion-size weights so "Meal Plan" sorts by volume:
  // Full LG (4) > Half LG (3) > Full RG (2) > Half RG (1).
  const PORTION_SIZE_WEIGHTS: Record<string, number> = {
    'HALF RG': 1,
    'HALF REGULAR': 1,
    SM: 1,
    SMALL: 1,
    RG: 2,
    REGULAR: 2,
    'HALF LG': 3,
    'HALF LARGE': 3,
    LG: 4,
    LARGE: 4,
  };
  const getPortionWeight = (size: string | null | undefined): number =>
    size ? PORTION_SIZE_WEIGHTS[size.toUpperCase().trim()] || 0 : 0;

  // Sort cycles: Default → active direction → back to Default (per column).
  const [nameSort, setNameSort] = useState<'default' | 'asc' | 'desc'>('default');
  const [portionSort, setPortionSort] = useState<'default' | 'asc' | 'desc'>('default');
  const [kitchenMode, setKitchenMode] = useState(false);
  const [isPanelRendered, setIsPanelRendered] = useState(false);
  const [isSlideInActive, setIsSlideInActive] = useState(false);
  const [isAccordionExpanded, setIsAccordionExpanded] = useState(false);
  const [isEditingParams, setIsEditingParams] = useState(false);

  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const addressContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [aiLoading, setAiLoading] = useState(false);

  // Toast notification state (e.g. success after reactivating a cancelled customer)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscription management state
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'cancelled'>('active');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  // Confirmation-modal target: lets the row dropdown reuse the drawer's dialogs
  // without forcing the edit drawer to open (null → drawer's selectedCustomer).
  const [confirmCustomer, setConfirmCustomer] = useState<Customer | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [pauseStartDate, setPauseStartDate] = useState('');
  const [pauseEndDate, setPauseEndDate] = useState('');
  const [isIndefinitePause, setIsIndefinitePause] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelDate, setCancelDate] = useState('');

  // Dedicated cancellation details modal state (cancelled filter view)
  const [showCancellationDetails, setShowCancellationDetails] = useState(false);
  const [cancellationDetailsCustomer, setCancellationDetailsCustomer] = useState<Customer | null>(null);
  const [cancelDetailDate, setCancelDetailDate] = useState('');
  const [cancelDetailReason, setCancelDetailReason] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactChannel, setContactChannel] = useState<ContactChannel>('phone');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [rawNotes, setRawNotes] = useState('');
  const [mealType, setMealType] = useState('');
  const [portionSize, setPortionSize] = useState('');
  const [planTier, setPlanTier] = useState<'trial' | 'weekly' | 'monthly'>('monthly');
  const [totalTiffinCredits, setTotalTiffinCredits] = useState<number>(20);
  const [startDate, setStartDate] = useState('');
  const [rotiCount, setRotiCount] = useState<number | ''>('');
  const [pronthiCount, setPronthiCount] = useState<number | ''>('');
  const [riceCount, setRiceCount] = useState('');
  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [selectedDays, setSelectedDays] = useState<string[]>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

  const formatSchedule = (days: string[]): string => {
    if (days.length === 0) return '';
    // Check if it matches weekdays (Mon-Fri)
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    if (days.length === 5 && weekdays.every(d => days.includes(d))) {
      return 'Monday to Friday';
    }
    // Weekdays + Saturday → Saturday's meal is packed & delivered on Friday (double pack)
    if (
      days.length === 6 &&
      weekdays.every(d => days.includes(d)) &&
      days.includes('Saturday')
    ) {
      return 'Monday to Friday, Saturday';
    }
    // Check if all 7 days
    if (days.length === 7) {
      return 'Monday to Sunday';
    }
    // Custom selection: abbreviated days joined by commas
    return days.map(d => d.substring(0, 3)).join(', ');
  };

  // Canonical storage value for the selected days, e.g. 'Mon,Tue,Wed,Thu,Fri'.
  const serializeSchedule = (days: string[]): string =>
    days.map(d => d.substring(0, 3)).join(',');

  const parseScheduleDays = (dbValue: string | null | undefined): string[] => {
    if (!dbValue || dbValue === '—') return [];
    // Check for "Monday to Friday" format
    if (dbValue.includes('Monday to Friday')) {
      const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      // Saturday meal rides along with Friday's delivery → restore Saturday too
      if (dbValue.includes('Saturday') || dbValue.includes('Sat')) {
        weekdays.push('Saturday');
      }
      // Check for exceptions like [EXCEPT: Wed]
      const exceptMatch = dbValue.match(/\[EXCEPT:\s*(.*?)\]/i);
      if (exceptMatch) {
        const exceptions = exceptMatch[1].split(',').map(s => s.trim());
        return weekdays.filter(d => !exceptions.some(e =>
          d.substring(0, 3).toLowerCase() === e.substring(0, 3).toLowerCase()
        ));
      }
      return weekdays;
    }
    // Check for "Monday to Sunday"
    if (dbValue.includes('Monday to Sunday')) {
      return ALL_DAYS;
    }
    // Comma-separated abbreviated or full names
    return ALL_DAYS.filter(day => {
      const short = day.substring(0, 3);
      return dbValue.includes(day) || dbValue.includes(short);
    });
  };

  // Keeps the schedule state consistent with current business rules:
  //  - Sunday is no longer offered.
  //  - Selecting Saturday always keeps Friday (Saturday meal is a Friday double pack).
  const normalizeScheduleDays = (days: string[]): string[] => {
    const withoutSunday = days.filter(d => d !== 'Sunday');
    if (withoutSunday.includes('Saturday') && !withoutSunday.includes('Friday')) {
      return [...withoutSunday, 'Friday'];
    }
    return withoutSunday;
  };

  // Saturday's meal is packed & delivered with Friday's → internal flag for double pack.
  const fridayDoublePack = selectedDays.includes('Saturday');

  const toggleScheduleDay = (day: string) => {
    // Friday cannot be removed while Saturday (Fri double-pack) is selected.
    if (day === 'Friday' && fridayDoublePack) return;

    if (day === 'Saturday') {
      if (selectedDays.includes('Saturday')) {
        setSelectedDays(selectedDays.filter(d => d !== 'Saturday'));
      } else {
        // Selecting Saturday forces Friday on so the double pack can be delivered.
        setSelectedDays([...new Set([...selectedDays, 'Friday', 'Saturday'])]);
      }
      return;
    }

    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const [sideNotes, setSideNotes] = useState('');
  // Rice counter state for the structured form
  const [riceRg, setRiceRg] = useState(0);
  const [riceLg, setRiceLg] = useState(0);
  const [riceXl, setRiceXl] = useState(0);
  // Structured side dish allocation state
  const [dalCount, setDalCount] = useState(1);
  const [sabjiCount, setSabjiCount] = useState(1);
  const [gravyCount, setGravyCount] = useState(0);
  const [chickenCount, setChickenCount] = useState(0);
  const [saladCount, setSaladCount] = useState(0);
  const [dessertCount, setDessertCount] = useState(0);
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Non-veg day-group side profile selectors
  const [mwfSideMode, setMwfSideMode] = useState<
    'default' | 'dal-chicken' | 'double-chicken' | 'double-gravy' | 'custom'
  >('default');
  const [vegDaySideMode, setVegDaySideMode] = useState<
    'default' | 'double-dal' | 'double-sabji' | 'custom'
  >('default');
  // Custom Tue/Thu side counts (used when vegDaySideMode === 'custom')
  const [tthDal, setTthDal] = useState(1);
  const [tthSabji, setTthSabji] = useState(1);
  const [tthChicken, setTthChicken] = useState(0);
  const [tthGravy, setTthGravy] = useState(0);
  // Discount section state
  const [discountType, setDiscountType] = useState<'none' | 'flat' | 'percent'>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [discountNote, setDiscountNote] = useState('');

  const totalCurryCount = dalCount + sabjiCount + gravyCount + chickenCount;
  const curryContainerLimit = isHalfPortion(portionSize) ? 1 : 2;

  const getDefaultRotiCount = (portion: string): number => {
    const p = normalizePortionToken(portion);
    if (isHalfPortion(p)) return 4; // single-container half plan
    return p === PORTION_LG ? 8 : 6; // RG → 6 rotis, LG → 8 rotis
  };

  const isStandardNonVegProfile = (dal: number, sabji: number, gravy: number, chicken: number): boolean =>
    dal === 0 && sabji === 1 && gravy === 0 && chicken === 1;

  // ═══════════════════════════════════════════════════════════════
  // Applies the automatic defaults when Meal Type or Portion Size toggles:
  //   Veg (RG/LG) → 1 Dal + 1 Sabji (RG 6 roti / LG 8 roti)
  //   Non-Veg (RG/LG) → 1 Sabji + Chicken Mon/Wed/Fri + veg Tue/Thu
  //   Half (RG/LG) → single container/day
  // ═══════════════════════════════════════════════════════════════
  const applyMealDefaults = (type: string, portion: string) => {
    const isNonVeg = type === 'Non-veg';
    const p = normalizePortionToken(portion);
    setRotiCount(getDefaultRotiCount(p));
    setPronthiCount(0);

    const largeAddonDefault = p === PORTION_LG ? 1 : 0;

    if (isHalfPortion(p)) {
      // Half plan = single container per day (Veg default: 1 Dal; Non-Veg default: 1 Chicken).
      setDalCount(isNonVeg ? 0 : 1);
      setSabjiCount(0);
      setGravyCount(0);
      setChickenCount(isNonVeg ? 1 : 0);
      setSaladCount(0);
      setDessertCount(0);
      setMwfSideMode('default');
      setVegDaySideMode('default');
    } else if (isNonVeg) {
      // M/W/F default = 1 Sabji + 1 Chicken; Tue/Thu default = 1 Dal + 1 Sabji.
      setMwfSideMode('default');
      setVegDaySideMode('default');
      setTthDal(1);
      setTthSabji(1);
      setTthChicken(0);
      setTthGravy(0);
      setDalCount(0);
      setSabjiCount(1);
      setGravyCount(0);
      setChickenCount(1);
      setSaladCount(largeAddonDefault);
      setDessertCount(largeAddonDefault);
    } else {
      setMwfSideMode('default');
      setVegDaySideMode('default');
      setTthDal(1);
      setTthSabji(1);
      setTthChicken(0);
      setTthGravy(0);
      setDalCount(1);
      setSabjiCount(1);
      setGravyCount(0);
      setChickenCount(0);
      setSaladCount(largeAddonDefault);
      setDessertCount(largeAddonDefault);
    }
  };

  const handleMealTypeChange = (newType: string) => {
    setMealType(newType);
    const activePortion = portionSize ? normalizePortionToken(portionSize) : PORTION_RG;
    if (!portionSize) setPortionSize(PORTION_RG);
    applyMealDefaults(newType, activePortion);
  };

  const handlePortionChange = (newPortion: string) => {
    const canonicalPortion = normalizePortionToken(newPortion);
    setPortionSize(canonicalPortion);
    const activeMealType = mealType || 'Veg';
    if (!mealType) setMealType('Veg');
    applyMealDefaults(activeMealType, canonicalPortion);
  };

  // Apply a single side-dish stepper change (used by the Veg curry steppers and
  // legacy Small single-select UI).
  const applySideCountChange = (
    key: 'dal' | 'sabji' | 'gravy' | 'chicken',
    nextValue: number
  ) => {
    if (key === 'dal') setDalCount(nextValue);
    if (key === 'sabji') setSabjiCount(nextValue);
    if (key === 'gravy') setGravyCount(nextValue);
    if (key === 'chicken') setChickenCount(nextValue);
  };

  useEffect(() => {
    if (selectedCustomer || isAddingNew) {
      setIsPanelRendered(true);
      setIsAccordionExpanded(false);
      setIsEditingParams(false);
      setAddressSuggestions([]);
      const timer = setTimeout(() => setIsSlideInActive(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsSlideInActive(false);
      const timer = setTimeout(() => setIsPanelRendered(false), 200);
      return () => clearTimeout(timer);
    }
  }, [selectedCustomer, isAddingNew]);

  // ═══════════════════════════════════════════════════════════════
  // Custom curry detection — drives the "⚡ Custom" pill and is saved
  // as `is_custom_curry` + `curry_config` (never into dietary notes).
  // ═══════════════════════════════════════════════════════════════
  const liveSideCounts: SideCounts = {
    dal: dalCount,
    sabji: sabjiCount,
    gravy: gravyCount,
    chicken: chickenCount,
    salad: saladCount,
    dessert: dessertCount,
  };
  const sideSummaryText = formatSideSummary(liveSideCounts);

  // Curry presets are only "custom" when the DAL/SABJI/CHICKEN/GRAVY counts deviate —
  // Salad/Dessert multiples never trigger curry mode or reset preset pills.
  const curryDeviation =
    sideSummaryText !== '' &&
    deviatesCurryFromDefault(
      mealType || 'Veg',
      normalizePortionToken(portionSize || PORTION_RG),
      liveSideCounts
    );

  // Extra add-ons beyond the plan's default allowance are tracked separately.
  const planDefaults = defaultSideCounts(
    mealType || 'Veg',
    normalizePortionToken(portionSize || PORTION_RG)
  );
  const addonFlags: string[] = [];
  if (saladCount > planDefaults.salad) addonFlags.push(formatSideAddon(saladCount, 'Salad'));
  if (dessertCount > planDefaults.dessert) addonFlags.push(formatSideAddon(dessertCount, 'Dessert'));
  const extraAddonNote = addonFlags.join(' + ');

  // Live profiles for the two non-veg day groups.
  const mwfLiveProfile = (): DayCurryProfile => ({
    dal: dalCount,
    chicken: chickenCount,
    sabji: sabjiCount,
    gravy: gravyCount,
  });
  const tthProfileForMode = (): DayCurryProfile => {
    if (vegDaySideMode === 'double-dal') return { ...DOUBLE_DAL_TTH_PROFILE };
    if (vegDaySideMode === 'double-sabji') return { ...TTH_PRESETS['double-sabji'] };
    if (vegDaySideMode === 'custom') {
      return { dal: tthDal, chicken: tthChicken, sabji: tthSabji, gravy: tthGravy };
    }
    return { ...DEFAULT_TTH_PROFILE };
  };

  const nonVegCustomSplit =
    mealType === 'Non-veg' &&
    !isHalfPortion(portionSize) &&
    (mwfSideMode !== 'default' || vegDaySideMode !== 'default');

  const buildWeeklyConfig = (): WeeklyCurryConfig => ({
    pattern_type: 'non_veg_rotation',
    mwf: mwfLiveProfile(),
    tth: tthProfileForMode(),
    extras: [
      saladCount > 0 ? (saladCount > 1 ? `${saladCount}x Salad` : 'Salad') : null,
      dessertCount > 0 ? (dessertCount > 1 ? `${dessertCount}x Dessert` : 'Dessert') : null,
    ].filter(
      (x): x is string => !!x
    ),
  });

  const curryCustomActive = !isHalfPortion(portionSize) && (curryDeviation || nonVegCustomSplit);

  const customCurryPillText = (() => {
    // Half plans are single-container by design — a 1-container allocation is the
    // valid standard order, so never surface the orange "Custom" banner for them.
    if (isHalfPortion(portionSize)) return '';
    if (nonVegCustomSplit) {
      // Mirror the NOTES-column badge: only list day groups that deviate from their
      // official default (null → no deviation → no preview banner).
      return formatCustomCurryBadge(mwfLiveProfile(), tthProfileForMode()) ?? '';
    }
    if (curryDeviation) {
      // Curry-only summary — add-ons are excluded so a 2x Salad doesn't read as a
      // "container override" (e.g. M/W/F: 1 Dal + 1 Sabji + 1 Chicken).
      const curryOnlySummary = formatSideSummary({ ...liveSideCounts, salad: 0, dessert: 0 });
      return curryOnlySummary || 'Custom';
    }
    return '';
  })();

  // Amber "⚡ Custom: …" note shown under the curry box for Half RG / Half LG plans.
  const customHalfNote = isHalfPortion(portionSize)
    ? formatHalfContainerNote(liveSideCounts, portionSize)
    : '';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (addressContainerRef.current && !addressContainerRef.current.contains(event.target as Node)) {
        setAddressSuggestions([]);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close the row action menu on any outside mousedown.
  useEffect(() => {
    if (!activeMenuId) return;
    function closeMenuOnOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest(`[data-action-menu="${activeMenuId}"]`)) {
        setActiveMenuId(null);
      }
    }
    document.addEventListener('mousedown', closeMenuOnOutside);
    return () => document.removeEventListener('mousedown', closeMenuOnOutside);
  }, [activeMenuId]);

  const showToast = (message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleAddressChange = (value: string) => {
    setDeliveryAddress(value);

    if (value.trim().length < 3) {
      setAddressSuggestions([]);
      return;
    }

    setIsAddressLoading(true);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(async () => {
      try {
        const hyphenUnitMatch = value.match(/^\s*([a-zA-Z0-9]+)\s*-\s*(\d+)/);
        const keywordUnitMatch = value.match(/^\s*(apt|apartment|unit|suite|ste|ph)\s*([a-zA-Z0-9]+)/i);

        let extractedUnitPrefix = '';
        let cleanSearchQuery = value;

        if (hyphenUnitMatch) {
          extractedUnitPrefix = `${hyphenUnitMatch[1]}-`;
          cleanSearchQuery = value.replace(/^\s*[a-zA-Z0-9]+\s*-\s*/, '');
        } else if (keywordUnitMatch) {
          extractedUnitPrefix = `${keywordUnitMatch[1].toUpperCase()} ${keywordUnitMatch[2]}, `;
          cleanSearchQuery = value.replace(/^\s*(apt|apartment|unit|suite|ste|ph)\s*[a-zA-Z0-9]+/i, '');
        }

        const houseNumberMatch = cleanSearchQuery.match(/^\s*(\d+[a-zA-Z]?)\b/);
        const typedHouseNumber = houseNumberMatch ? houseNumberMatch[1] : null;

        const data = await searchAddress(cleanSearchQuery);

        if (data && Array.isArray(data)) {
          const formattedSuggestions = data.map((item: any) => {
            const addr = item.address;
            if (!addr) return item.display_name;

            let houseNumber = addr.house_number || '';
            const street = addr.road || addr.suburb || '';

            if (!houseNumber && typedHouseNumber) {
              houseNumber = typedHouseNumber;
            }

            const streetAddress = houseNumber ? `${houseNumber} ${street}` : street;
            const city = addr.city || addr.town || addr.village || addr.municipality || '';
            const province = (addr.state === 'Ontario') ? 'ON' : (addr.state || '');
            const postalCode = addr.postcode || '';

            let finalAddressLine = '';
            if (streetAddress && city) {
              finalAddressLine = `${streetAddress}, ${city}, ${province} ${postalCode}`;
            } else {
              finalAddressLine = item.display_name
                .replace(/, Southwestern Ontario|, Middlesex County|, Canada/gi, '')
                .replace(/Ontario/g, 'ON');
            }

            if (extractedUnitPrefix && !finalAddressLine.toLowerCase().startsWith(extractedUnitPrefix.toLowerCase())) {
              finalAddressLine = `${extractedUnitPrefix}${finalAddressLine}`;
            }

            return finalAddressLine.replace(/\s+/g, ' ').trim();
          });

          setAddressSuggestions([...new Set(formattedSuggestions)]);
        }
      } catch (err) {
        console.error("Address auto-complete fetch mistake encountered:", err);
      } finally {
        setIsAddressLoading(false);
      }
    }, 800);
  };

  const closePanelGracefully = () => {
    setIsSlideInActive(false);
    setTimeout(() => {
      setSelectedCustomer(null);
      setIsAddingNew(false);
    }, 200);
  };

  const cycleNameSort = () => {
    const next = nameSort === 'default' ? 'asc' : nameSort === 'asc' ? 'desc' : 'default';
    setNameSort(next);
    if (next !== 'default') {
      setPortionSort('default');
      setKitchenMode(false);
    }
  };

  // Meal-plan sort by portion volume: Default → Large→Small (desc) → Small→Large (asc).
  const cyclePortionSort = () => {
    const next = portionSort === 'default' ? 'desc' : portionSort === 'desc' ? 'asc' : 'default';
    setPortionSort(next);
    if (next !== 'default') {
      setNameSort('default');
      setKitchenMode(false);
    }
  };

  // Kitchen Dispatch / Packing Order mode: Non-Veg → Large → Regular → Small → A–Z.
  const toggleKitchenMode = () => {
    const next = !kitchenMode;
    setKitchenMode(next);
    if (next) {
      setNameSort('default');
      setPortionSort('default');
    }
  };

  // Opens the edit drawer for the given customer (used by the row Edit action).
  const handleEditCustomer = (customer: Customer) => {
    setActiveMenuId(null);
    handleRowClick(customer);
  };

  // Quick subscription actions from the row overflow menu.
  const runRowStatusAction = (
    customer: Customer,
    action: 'pause' | 'resume' | 'cancel'
  ) => {
    setActiveMenuId(null);
    startTransition(async () => {
      try {
        if (action === 'pause') {
          await pauseCustomer(customer.id, new Date().toISOString().split('T')[0], null);
          showToast(`${customer.full_name} paused`);
        } else if (action === 'resume') {
          await resumeCustomer(customer.id);
          showToast(`${customer.full_name} resumed`);
        } else {
          await cancelCustomer(customer.id, null);
          showToast(`${customer.full_name} cancelled`);
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : `Failed to ${action} customer`, 'error');
      }
    });
  };

  // Menu wrapper that maps a target status to the correct server action.
  const handleUpdateStatus = (
    customer: Customer,
    nextStatus: 'active' | 'paused' | 'cancelled'
  ) => {
    if (nextStatus === 'active') runRowStatusAction(customer, 'resume');
    else if (nextStatus === 'paused') runRowStatusAction(customer, 'pause');
    else runRowStatusAction(customer, 'cancel');
  };

  const handleUpdateCustomerStatus = (
    customerId: string,
    nextStatus: 'active' | 'paused' | 'cancelled'
  ) => {
    const customer = initialCustomers.find(c => c.id === customerId);
    if (customer) handleUpdateStatus(customer, nextStatus);
  };

  // Executes the destructive delete by customer id (confirmation is handled by the caller).
  const handleDeleteCustomer = (customerId: string) => {
    setActiveMenuId(null);
    const customer = initialCustomers.find(c => c.id === customerId);
    startTransition(async () => {
      try {
        await deleteCustomer(customerId);
        showToast(customer ? `${customer.full_name} deleted` : 'Customer deleted');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to delete customer', 'error');
      }
    });
  };

  // Opens one of the shared confirmation dialogs for a customer (row dropdown or drawer).
  const openConfirmModalForCustomer = (
    customer: Customer,
    type: 'pause' | 'cancel' | 'delete'
  ) => {
    setActiveMenuId(null);
    setConfirmCustomer(customer);
    // Reset per-dialog inputs.
    setPauseStartDate('');
    setPauseEndDate('');
    setIsIndefinitePause(false);
    setCancelDate(new Date().toISOString().split('T')[0]);
    setCancelReason('');
    if (type === 'pause') setShowPauseModal(true);
    else if (type === 'cancel') setShowCancelModal(true);
    else setShowDeleteModal(true);
  };

  const formatRiceCellText = (rawRice: string | null | undefined): string => {
    if (!rawRice || rawRice === 'None' || rawRice === '—') return 'None';

    let tokens = rawRice.toLowerCase().split('+');
    let dynamicArray = tokens.map(token => {
      let segment = token.replace(/\s+x\s+/g, ' ').trim();
      if (/^\d+\s*(rg|lg|xl)$/.test(segment)) return segment;

      let qtyMatch = segment.match(/^(\d+)/);
      let qty = qtyMatch ? qtyMatch[1] : '1';

      let size = 'rg';
      if (segment.includes('xl') || segment.includes('extra')) size = 'xl';
      else if (segment.includes('lg') || segment.includes('large')) size = 'lg';
      else if (segment.includes('rg') || segment.includes('regular')) size = 'rg';

      return `${qty} ${size}`;
    });

    return dynamicArray.join(' + ');
  };

  const cleanScheduleText = (scheduleStr: string | null | undefined): string => {
    if (!scheduleStr) return '';
    return scheduleStr.replace(/Custom Days:\s*/gi, '').trim();
  };

  // Renders a stored schedule as a compact shorthand badge, e.g. "Mon – Fri",
  // "M / W / F", or "Mon – Fri • Sat" — never truncates.
  const getScheduleBadgeText = (customer: Customer): string => {
    const days = normalizeScheduleDays(parseScheduleDays(customer.delivery_schedule));
    if (days.length === 0) return '';

    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const hasAllWeekdays = weekdays.every(d => days.includes(d));
    const hasSaturday = days.includes('Saturday');
    if (hasAllWeekdays && !hasSaturday) return 'Mon – Fri';
    if (hasAllWeekdays && hasSaturday) return 'Mon – Fri • Sat';

    const dayLetters: Record<string, string> = {
      Monday: 'M',
      Tuesday: 'T',
      Wednesday: 'W',
      Thursday: 'Th',
      Friday: 'F',
      Saturday: 'Sat',
    };
    return days.map(d => dayLetters[d] || d.substring(0, 3)).join(' / ');
  };

  // Human-readable tooltip for the SCHEDULE badge (e.g. "Monday to Friday"),
  // derived from the stored schedule instead of echoing its raw value.
  const getScheduleTooltip = (customer: Customer): string => {
    const days = normalizeScheduleDays(parseScheduleDays(customer.delivery_schedule));
    if (days.length === 0) return cleanScheduleText(customer.delivery_schedule);
    return formatSchedule(days) || cleanScheduleText(customer.delivery_schedule);
  };



  const filteredCustomers = initialCustomers.filter(c => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      c.full_name.toLowerCase().includes(term) ||
      (c.phone_number || '').toLowerCase().includes(term) ||
      (c.delivery_address || '').toLowerCase().includes(term);
    const normalizedMeal = (c.meal_type || '').toLowerCase();
    const status = (c.subscription_status || 'active').toLowerCase();

    // Meal type filter
    if (activeTab === 'veg') {
      if (!(normalizedMeal.includes('veg') && !normalizedMeal.includes('non'))) return false;
    }
    if (activeTab === 'non-veg') {
      if (!normalizedMeal.includes('non')) return false;
    }

    // Subscription status filter
    if (statusFilter === 'active' && status !== 'active') return false;
    if (statusFilter === 'paused' && status !== 'paused') return false;
    if (statusFilter === 'cancelled' && status !== 'cancelled') return false;

    return matchesSearch;
  });

  const sortedCustomers = [...filteredCustomers].sort((a, b) => {
    // Kitchen Dispatch / Packing Order mode takes precedence when active.
    if (kitchenMode) return kitchenDispatchSort(a, b);
    // Meal-plan sort by portion volume (Small → Regular → Large); name sort otherwise.
    if (portionSort !== 'default') {
      const diff =
        portionSort === 'desc'
          ? getPortionWeight(b.portion_size) - getPortionWeight(a.portion_size)
          : getPortionWeight(a.portion_size) - getPortionWeight(b.portion_size);
      if (diff !== 0) return diff;
      // Tie-breaker: alphabetical by full name when portion sizes match.
      return a.full_name.localeCompare(b.full_name);
    }
    // Name sort (Default → A–Z → Z–A).
    if (nameSort !== 'default') {
      const valA = a.full_name.toLowerCase();
      const valB = b.full_name.toLowerCase();
      return nameSort === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    }
    return 0;
  });

  const handleOpenAddForm = () => {
    setFullName('');
    setPhoneNumber('');
    setContactChannel('phone');
    setDeliveryAddress('');
    setRawNotes('');
    setMealType('');
    setPortionSize('');
    setPlanTier('monthly');
    setTotalTiffinCredits(20);
    setStartDate('');
    setRotiCount('');
    setPronthiCount('');
    setRiceCount('');
    setRiceRg(0);
    setRiceLg(0);
    setRiceXl(0);
    setDalCount(0);
    setSabjiCount(0);
    setGravyCount(0);
    setChickenCount(0);
    setMwfSideMode('default');
    setVegDaySideMode('default');
    setTthDal(1);
    setTthSabji(1);
    setTthChicken(0);
    setTthGravy(0);
    setSaladCount(0);
    setDessertCount(0);
    setSelectedDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    setSideNotes('');
    setSpecialInstructions('');
    setDiscountType('none');
    setDiscountValue('');
    setDiscountNote('');
    setCancelReason('');
    setCancelDate('');
    setIsAddingNew(true);
  };

  const parseRiceIntoCounters = (riceStr: string | null | undefined) => {
    let rg = 0, lg = 0, xl = 0;
    if (!riceStr || riceStr === 'None' || riceStr === '—') return { rg, lg, xl };
    const tokens = riceStr.split('+');
    tokens.forEach(token => {
      const match = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/);
      if (match) {
        const qty = parseInt(match[1], 10);
        const size = match[2];
        if (size === 'rg') rg += qty;
        else if (size === 'lg') lg += qty;
        else if (size === 'xl') xl += qty;
      }
    });
    return { rg, lg, xl };
  };

  const parseSideDishAll = (instructions: string | null) => {
    const result = { dal: 0, sabji: 0, gravy: 0, chicken: 0, salad: 0, dessert: 0 };
    if (!instructions) return result;
    const lower = instructions.toLowerCase();

    const extractCount = (keyword: string): number => {
      const match = lower.match(new RegExp(`(\\d+)\\s*${keyword}`));
      return match ? parseInt(match[1], 10) : 0;
    };

    // Reads add-on counts from strings like "Salad", "2x Salad", or "2 Salad".
    const extractAddon = (keyword: string): number => {
      const xMatch = lower.match(new RegExp(`(\\d+)\\s*x\\s*${keyword}`));
      if (xMatch) return parseInt(xMatch[1], 10);
      const plainMatch = lower.match(new RegExp(`(\\d+)\\s*${keyword}`));
      if (plainMatch) return parseInt(plainMatch[1], 10);
      return lower.includes(keyword) ? 1 : 0;
    };

    result.dal = extractCount('dal');
    result.sabji = extractCount('sabji');
    result.gravy = extractCount('gravy');
    result.chicken = extractCount('chicken');
    if (lower.includes('both dal') && result.dal === 0) result.dal = 2;
    if (lower.includes('both sabji') && result.sabji === 0) result.sabji = 2;
    result.salad = extractAddon('salad');
    result.dessert = extractAddon('dessert');

    return result;
  };

  const handleRowClick = (customer: Customer) => {
    setIsAddingNew(false);
    setSelectedCustomer(customer);
    setFullName(customer.full_name || '');
    const parsedContact = parseStoredContact(customer.phone_number);
    setPhoneNumber(parsedContact.value);
    setContactChannel(parsedContact.channel);
    setDeliveryAddress(customer.delivery_address || '');
    setRawNotes(customer.dietary_notes || '');
    setMealType(customer.meal_type || '');

    const restoredPortion = customer.portion_size ? normalizePortionToken(customer.portion_size) : PORTION_RG;
    setPortionSize(restoredPortion);
    applyMealDefaults(customer.meal_type || 'Veg', restoredPortion);

    // Restore subscription plan + optional start date.
    const restoredTier =
      customer.plan_tier === 'trial' || customer.plan_tier === 'weekly' || customer.plan_tier === 'monthly'
        ? customer.plan_tier
        : 'monthly';
    setPlanTier(restoredTier);
    setTotalTiffinCredits(
      customer.total_tiffin_credits && customer.total_tiffin_credits > 0
        ? customer.total_tiffin_credits
        : PLAN_OPTIONS.find(o => o.key === restoredTier)?.credits ?? 20
    );
    setStartDate(customer.start_date ? customer.start_date.slice(0, 10) : '');

    // ⚠️ Restore DB values AFTER defaults — prevents defaults from overwriting saved data
    if (customer.roti_count !== null && customer.roti_count !== undefined) {
      setRotiCount(customer.roti_count);
    }
    if (customer.pronthi_count !== null && customer.pronthi_count !== undefined) {
      setPronthiCount(customer.pronthi_count);
    }

    const riceCounters = parseRiceIntoCounters(customer.rice_count);
    setRiceRg(riceCounters.rg);
    setRiceLg(riceCounters.lg);
    setRiceXl(riceCounters.xl);

    setRiceCount(formatRiceCellText(customer.rice_count));
    // Restore schedule under current rules (no Sunday; Saturday keeps Friday on).
    // Records without a stored schedule open on the standard Mon–Fri default.
    const restoredDays = normalizeScheduleDays(parseScheduleDays(customer.delivery_schedule));
    setSelectedDays(restoredDays.length > 0 ? restoredDays : [...WEEKDAY_DELIVERY_DAYS]);

    // Parse existing delivery_instructions — restores ALL side dish state
    const sideDish = parseSideDishAll(customer.delivery_instructions);
    const hasAnySideDish = sideDish.dal > 0 || sideDish.sabji > 0 || sideDish.gravy > 0 || sideDish.chicken > 0;
    const loadedMealType = customer.meal_type || '';
    if (hasAnySideDish) {
      setDalCount(sideDish.dal);
      setSabjiCount(sideDish.sabji);
      setGravyCount(sideDish.gravy);
      setChickenCount(sideDish.chicken);
      setSaladCount(Number(sideDish.salad) || 0);
      setDessertCount(Number(sideDish.dessert) || 0);
      // Restore the Tue/Thu (veg-day) side profile from the stored structured config.
      if (loadedMealType === 'Non-veg') {
        const weeklyConfig = parseWeeklyCurryConfig(customer.curry_config);
        if (weeklyConfig) {
          const mwf = normalizeDayProfile(weeklyConfig.mwf);
          setDalCount(mwf.dal);
          setSabjiCount(mwf.sabji);
          setChickenCount(mwf.chicken);
          setGravyCount(mwf.gravy || 0);
          // Match MWF to a quick pill when possible; otherwise keep custom counts.
          const mwfPresetKey = (Object.keys(MWF_PRESETS) as (keyof typeof MWF_PRESETS)[]).find(
            key => dayProfilesEqual(MWF_PRESETS[key], mwf)
          );
          setMwfSideMode(
            (mwfPresetKey && mwfPresetKey !== 'custom'
              ? mwfPresetKey
              : 'custom') as
              | 'default'
              | 'dal-chicken'
              | 'double-chicken'
              | 'double-gravy'
              | 'custom'
          );

          const tth = normalizeDayProfile(weeklyConfig.tth);
          if (isDoubleDalTTh(tth)) {
            setVegDaySideMode('double-dal');
          } else if (dayProfilesEqual(tth, TTH_PRESETS['double-sabji'])) {
            setVegDaySideMode('double-sabji');
          } else if (isDefaultTTh(tth)) {
            setVegDaySideMode('default');
          } else {
            setVegDaySideMode('custom');
          }
          setTthDal(tth.dal);
          setTthSabji(tth.sabji);
          setTthChicken(tth.chicken);
          setTthGravy(tth.gravy || 0);
        } else if (customer.is_custom_curry === true) {
          // Legacy text config: surface as custom day-group profiles for editing.
          setMwfSideMode('custom');
          setVegDaySideMode('custom');
          setDalCount(sideDish.dal || 1);
          setSabjiCount(sideDish.sabji || 0);
          setChickenCount(sideDish.chicken || 0);
          setTthDal(sideDish.dal || 1);
          setTthSabji(sideDish.sabji || 1);
          setTthChicken(0);
          setTthGravy(0);
        } else {
          setMwfSideMode('default');
          setVegDaySideMode('default');
          setTthDal(1);
          setTthSabji(1);
          setTthChicken(0);
          setTthGravy(0);
        }
      }
    }
    if (customer.delivery_instructions) setSideNotes(customer.delivery_instructions);
    setSpecialInstructions(customer.dietary_notes || '');

    // Restore discount fields
    setDiscountType(
      customer.discount_type === 'flat' || customer.discount_type === 'percent'
        ? customer.discount_type
        : 'none'
    );
    setDiscountValue(
      customer.discount_value !== null && customer.discount_value !== undefined
        ? String(customer.discount_value)
        : ''
    );
    setDiscountNote(customer.discount_note || '');
    setCancelReason('');
    setCancelDate('');
  };

  const triggerAiParser = async () => {
    if (!rawNotes.trim()) return;
    setAiLoading(true);
    setIsEditingParams(false);

    const lowerText = rawNotes.toLowerCase();

    // ═══════════════════════════════════════════════════════════════
    // STEP 1 — Detect Meal Type → 'Veg' or 'Non-veg'
    // ═══════════════════════════════════════════════════════════════
    let detectedMealType = '';
    if (
      lowerText.includes('non-veg') || lowerText.includes('non veg') ||
      lowerText.includes('nv') || lowerText.includes('nonveg') ||
      lowerText.includes('nonvegitarian')
    ) {
      detectedMealType = 'Non-veg';
    } else if (
      lowerText.includes('veg') || lowerText.includes('vegetarian') ||
      lowerText.includes('vegan')
    ) {
      detectedMealType = 'Veg';
    }
    setMealType(detectedMealType);

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 — Detect Portion Size → 'Small', 'Regular', 'Large'
    // ═══════════════════════════════════════════════════════════════
    let detectedPortion = 'Regular'; // default
    // Check Large first so "small" inside "lg" doesn't confuse
    if (
      lowerText.includes('large') || lowerText.includes(' lg') ||
      lowerText.startsWith('lg') || lowerText.includes('(lg)')
    ) {
      detectedPortion = 'Large';
    } else if (
      lowerText.includes('small') || lowerText.includes(' sm') ||
      lowerText.startsWith('sm') || lowerText.includes('(sm)')
    ) {
      detectedPortion = 'Small';
    }
    setPortionSize(detectedPortion);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3 — Apply Portion-Size Defaults (rotis + curries)
    // ═══════════════════════════════════════════════════════════════
    const PORTION_DEFAULTS: Record<string, { roti: number; curries: number; premium: string }> = {
      Small:  { roti: 4, curries: 1, premium: '' },
      Regular:{ roti: 6, curries: 2, premium: '' },
      Large:  { roti: 8, curries: 2, premium: ' + Salad + Dessert (weekly)' },
    };

    let defaultRoti = PORTION_DEFAULTS[detectedPortion].roti;
    const defaultCurries = PORTION_DEFAULTS[detectedPortion].curries;
    const defaultPremium = PORTION_DEFAULTS[detectedPortion].premium;

    // ═══════════════════════════════════════════════════════════════
    // STEP 4 — Check for Explicit Roti Override
    // ═══════════════════════════════════════════════════════════════
    const explicitRotiMatch = lowerText.match(/(\d+)\s*rotis?\b/);
    if (explicitRotiMatch) {
      defaultRoti = parseInt(explicitRotiMatch[1], 10);
    }
    setRotiCount(defaultRoti);

    // ═══════════════════════════════════════════════════════════════
    // STEP 5 — Detect Rice Portion
    // ═══════════════════════════════════════════════════════════════
    if (
      lowerText.includes('no rice') || lowerText.includes('without rice') ||
      lowerText.includes('zero rice')
    ) {
      setRiceCount('None');
    } else {
      // Normalise implicit quantities: "lg rice" → "1 lg rice"
      let riceText = lowerText.replace(
        /(?<!\d\s*)(rg|regular|lg|large|xl|extra large|extra-large)\s*rice/g,
        '1 $1 rice'
      );
      // Also catch patterns like "2x lg rice" → normalise to "2 lg"
      riceText = riceText.replace(/(\d+)x\s*(rg|lg|xl)/g, '$1 $2');

      const riceRegex = /(\d+)\s*(rg|regular|lg|large|xl|extra large|extra-large)/g;
      const riceMatches: string[] = [];
      let riceMatch;

      while ((riceMatch = riceRegex.exec(riceText)) !== null) {
        const qty = riceMatch[1];
        let size = riceMatch[2];
        if (size === 'regular' || size === 'rg') size = 'rg';
        else if (size === 'large' || size === 'lg') size = 'lg';
        else if (size === 'extra large' || size === 'extra-large' || size === 'xl') size = 'xl';
        riceMatches.push(`${qty} ${size}`);
      }

      if (riceMatches.length > 0) {
        setRiceCount([...new Set(riceMatches)].join(' + '));
      } else if (lowerText.includes('rice')) {
        setRiceCount('1 rg');
      } else {
        setRiceCount('None');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 6 — Build Side Dish Notes from Defaults + Overrides
    // ═══════════════════════════════════════════════════════════════
    let sideComboNotes = `${defaultCurries} Curry`;

    // Check for explicit side dish overrides
    const hasBothDal = lowerText.includes('both dal') || lowerText.includes('2 dal');
    const hasBothSabji = lowerText.includes('both sabji') || lowerText.includes('both sabzi') || lowerText.includes('2 sabji');
    const hasOnlyDal = lowerText.includes('only dal') || lowerText.includes('1 dal');
    const hasOnlySabji = lowerText.includes('only sabji') || lowerText.includes('only sabzi');
    const hasCurryOnly = lowerText.includes('curry only') || lowerText.includes('only curry') || lowerText.includes('no leg');
    const hasDoubleChicken = lowerText.includes('both chicken') || lowerText.includes('2 chicken') || lowerText.includes('both curry');
    const hasExtraCurry = lowerText.includes('extra curry') || lowerText.includes('extra gravy');

    // Start with the portion-based default sabji/dal split
    const curryCount = defaultCurries;

    if (hasDoubleChicken) {
      sideComboNotes = `Both Chicken Curry (No Veg Sabji) — ${curryCount} curry total`;
    } else if (hasCurryOnly) {
      sideComboNotes = `Only Curry (No Leg) — ${curryCount} curry`;
    } else if (hasBothDal) {
      sideComboNotes = `Both Dal (No Sabji) — ${curryCount} curry`;
    } else if (hasBothSabji) {
      sideComboNotes = `Both Sabji (No Dal) — ${curryCount} curry`;
    } else if (hasOnlyDal) {
      sideComboNotes = `1 Dal Only — ${curryCount} curry`;
    } else if (hasOnlySabji) {
      sideComboNotes = `1 Sabji Only — ${curryCount} curry`;
    } else {
      // Default split based on portion size
      const dalSabji = `1 Dal + 1 Sabji`;
      sideComboNotes = `${dalSabji} (${curryCount} curries default)${defaultPremium}`;
    }

    if (hasExtraCurry && !hasDoubleChicken) {
      sideComboNotes = sideComboNotes.replace(/(\d+) curry/, (_, n) => `${parseInt(n) + 1} curries`);
      sideComboNotes += ' + Extra Curry';
    }

    setSideNotes(sideComboNotes);

    // ═══════════════════════════════════════════════════════════════
    // STEP 7 — Parse Delivery Schedule (unchanged logic)
    // ═══════════════════════════════════════════════════════════════
    let detectedSchedule = '';
    let detectedSkips: string[] = [];

    const daysMap: { [key: string]: string } = {
      monday: 'Mon', mon: 'Mon', m: 'Mon',
      tuesday: 'Tue', tue: 'Tue', t: 'Tue',
      wednesday: 'Wed', wed: 'Wed', w: 'Wed',
      thursday: 'Thu', thu: 'Thu', th: 'Thu',
      friday: 'Fri', fri: 'Fri', f: 'Fri',
      saturday: 'Sat', sat: 'Sat',
      sunday: 'Sun', sun: 'Sun'
    };

    let scheduleText = lowerText.replace(/friay|fiday/g, 'friday').replace(/mondya/g, 'monday');

    const segments = scheduleText.split(/[;,]/).map(s => s.trim());
    segments.forEach(segment => {
      if (segment.includes('skip') || segment.includes('pause') || segment.includes('no service')) {
        Object.keys(daysMap).forEach(dayKey => {
          if (segment.includes(dayKey) && !detectedSkips.includes(daysMap[dayKey])) {
            detectedSkips.push(daysMap[dayKey]);
          }
        });
      }
    });

    const isMonToFri = /(mon(day)?\s*(to|-)\s*fri(day)?)/i.test(scheduleText) || scheduleText.includes('m to f') || scheduleText.includes('m-f');

    if (isMonToFri) {
      detectedSchedule = 'Monday to Friday';
      const activeTextOnly = scheduleText.replace(/skip\s+[a-z]+/g, '');
      if (/\bsat(urday)?\b/.test(activeTextOnly)) detectedSchedule += ', Saturday';
      if (/\bsun(day)?\b/.test(activeTextOnly)) detectedSchedule += ', Sunday';
    } else {
      const specificDays: string[] = [];
      const activeTextOnly = scheduleText.replace(/skip\s+[a-z]+/g, '');
      const dayNamesOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

      dayNamesOrder.forEach(day => {
        if (activeTextOnly.includes(day) || new RegExp(`\\b${day.substring(0, 3)}\\b`).test(activeTextOnly)) {
          const formattedDay = day.charAt(0).toUpperCase() + day.slice(1, 3);
          if (!specificDays.includes(formattedDay)) specificDays.push(formattedDay);
        }
      });

      if (specificDays.length > 0) {
        detectedSchedule = specificDays.join(', ');
      } else {
        detectedSchedule = 'Monday to Friday (Default)';
      }
    }

    if (detectedSkips.length > 0) {
      detectedSchedule += ` [EXCEPT: ${detectedSkips.join(', ')}]`;
    }
    // setSchedule(detectedSchedule); // Parser disabled — using day toggle UI instead

    // ═══════════════════════════════════════════════════════════════
    // STEP 8 — Gemini AI Enhancement (fallback, may override above)
    // ═══════════════════════════════════════════════════════════════
    try {
      const response = await fetch('/api/parse-dietary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawNotes }),
      });
      const data = await response.json();
      if (data && !data.error) {
        if (data.meal_type) setMealType(data.meal_type);
        if (data.roti_count !== undefined && data.roti_count !== null) setRotiCount(data.roti_count);
      }
    } catch (err) {
      console.warn("AI busy or endpoint unavailable. Fallback strategy completely deployed smoothly.", err);
    } finally {
      setAiLoading(false);
    }

    // ═══════════════════════════════════════════════════════════════
    // Embedded test cases (verify expected outputs match)
    // ═══════════════════════════════════════════════════════════════
    //
    // Test 1: "Veg rg, 2x lg rice, 5 rotis"
    //   → meal_type: 'Veg', portion: 'Regular'
    //   → roti: 5 (override from default 6)
    //   → rice: '2 lg', side: '1 Dal + 1 Sabji (2 curries default)'
    //
    // Test 2: "non-veg sm, 4 roti"
    //   → meal_type: 'Non-veg', portion: 'Small'
    //   → roti: 4 (matches small default), rice: 'None'
    //   → side: '1 Dal + 1 Sabji (1 curry default)'
    //
    // Test 3: "veg lg but only 3 roti, 1 xl rice"
    //   → meal_type: 'Veg', portion: 'Large'
    //   → roti: 3 (override from default 8), rice: '1 xl'
    //   → side: '1 Dal + 1 Sabji (2 curries default) + Salad + Dessert (weekly)'
    //
    // Test 4: "non-veg regular, 1 lg rice, both sabji, skip wed"
    //   → meal_type: 'Non-veg', portion: 'Regular'
    //   → roti: 6 (regular default), rice: '1 lg'
    //   → side: 'Both Sabji (No Dal) — 2 curry'
    //   → schedule: 'Monday to Friday [EXCEPT: Wed]'
    //
    // Test 5: "veg small, no rice, 2 roti"
    //   → meal_type: 'Veg', portion: 'Small'
    //   → roti: 2 (override from default 4), rice: 'None'
    //   → side: '1 Dal + 1 Sabji (1 curry default)'
    // ═══════════════════════════════════════════════════════════════
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Store canonical portion tokens: RG / LG / Half RG / Half LG.
    const finalPortion = portionSize ? normalizePortionToken(portionSize) : PORTION_RG;

    // Build rice string from individual counters
    const riceParts: string[] = [];
    if (riceRg > 0) riceParts.push(`${riceRg} rg`);
    if (riceLg > 0) riceParts.push(`${riceLg} lg`);
    if (riceXl > 0) riceParts.push(`${riceXl} xl`);
    const builtRice = riceParts.length > 0 ? riceParts.join(' + ') : 'None';

    // Build structured side dish string from all curry counts
    const sideParts: string[] = [];
    if (dalCount > 0) sideParts.push(`${dalCount} Dal`);
    if (sabjiCount > 0) sideParts.push(`${sabjiCount} Sabji`);
    if (gravyCount > 0) sideParts.push(`${gravyCount} Gravy`);
    if (chickenCount > 0) sideParts.push(`${chickenCount} Chicken`);
    let structuredSideDish = sideParts.length > 0 ? sideParts.join(' + ') : '';
    if (saladCount > 0) structuredSideDish += ` + ${formatSideAddon(saladCount, 'Salad')}`;
    if (dessertCount > 0) structuredSideDish += ` + ${formatSideAddon(dessertCount, 'Dessert')} (weekly)`;

    const discountNumber =
      discountType === 'none' || discountValue.trim() === '' ? null : Number(discountValue);

    // Only write the discount columns when a discount is actually configured, or when this
    // customer previously stored one (so clearing it sends nulls). Omitting them entirely when
    // unused keeps saves working even if the discount columns don't exist in the DB yet.
    const hasStoredDiscount =
      !isAddingNew &&
      !!selectedCustomer &&
      (selectedCustomer.discount_type != null ||
        selectedCustomer.discount_value != null ||
        selectedCustomer.discount_note != null);
    const discountConfigured =
      discountType !== 'none' || discountValue.trim() !== '' || discountNote.trim() !== '';

    // Same guard for the custom-curry metadata columns (is_custom_curry / curry_config):
    // they are only written when a custom profile is actually configured, or when this
    // customer previously stored one (so reverting to standard sends nulls).
    const hasStoredCustomCurry =
      !isAddingNew &&
      !!selectedCustomer &&
      (selectedCustomer.is_custom_curry === true ||
        (selectedCustomer.curry_config || '').trim() !== '');
    const curryIsCustom = curryCustomActive;
    // Non-veg Tue/Thu splits are stored as structured weekly JSON; veg-side deviations are
    // stored as a `veg_fixed` structured config (same day profile on both groups).
    const extrasForConfig = [
      saladCount > 0 ? (saladCount > 1 ? `${saladCount}x Salad` : 'Salad') : null,
      dessertCount > 0 ? (dessertCount > 1 ? `${dessertCount}x Dessert` : 'Dessert') : null,
    ].filter(
      (x): x is string => !!x
    );
    const curryConfigForSave = nonVegCustomSplit
      ? JSON.stringify(buildWeeklyConfig())
      : curryIsCustom && mealType !== 'Non-veg'
        ? JSON.stringify({
            pattern_type: 'veg_fixed' as const,
            mwf: { dal: dalCount, chicken: chickenCount, sabji: sabjiCount, gravy: gravyCount || 0 },
            tth: { dal: dalCount, chicken: chickenCount, sabji: sabjiCount, gravy: gravyCount || 0 },
            extras: extrasForConfig,
          } as WeeklyCurryConfig)
        : curryIsCustom
          ? customCurryPillText
          : null;

    // Saturday's meal ships together with Friday's → flag the kitchen double pack.
    const finalInstructions =
      (structuredSideDish || '1 Dal + 1 Sabji') +
      (fridayDoublePack ? ' [NOTE: Pack 2 Tiffins on Friday for Saturday meal]' : '');

    const payload = {
      full_name: fullName.trim(),
      phone_number: formatContactValue(contactChannel, phoneNumber) || null,
      delivery_address: deliveryAddress.trim(),
      dietary_notes: specialInstructions.trim() || null,
      meal_type: mealType || 'Veg',
      portion_size: finalPortion,
      plan_tier: planTier,
      total_tiffin_credits: totalTiffinCredits,
      start_date: startDate.trim() || null,
      roti_count: rotiCount === '' ? null : Number(rotiCount),
      pronthi_count: pronthiCount === '' ? null : Number(pronthiCount),
      rice_count: builtRice,
      delivery_schedule: serializeSchedule(selectedDays) || DEFAULT_DELIVERY_SCHEDULE,
      delivery_instructions: finalInstructions,
      // Structured custom-curry metadata lives in its own columns — never dietary_notes.
      ...(curryIsCustom || hasStoredCustomCurry
        ? {
            is_custom_curry: curryIsCustom,
            curry_config: curryIsCustom ? curryConfigForSave : null,
          }
        : {}),
      ...(discountConfigured || hasStoredDiscount
        ? {
            discount_type: discountType === 'none' ? null : discountType,
            discount_value:
              discountNumber !== null && Number.isFinite(discountNumber) ? discountNumber : null,
            discount_note: discountNote.trim() || null,
          }
        : {})
    };

    startTransition(async () => {
      try {
        if (isAddingNew) {
          await createCustomer(payload);
        } else if (selectedCustomer) {
          await updateCustomer(selectedCustomer.id, payload);
        }
        closePanelGracefully();
      } catch (err: any) {
        console.error("Submission rejected by database:", err);
        alert(`Supabase Database Rejected Save Request: ${err.message || err}`);
      }
    });
  };

  const getRiceSummary = () => {
    const parts: string[] = [];
    if (riceRg > 0) parts.push(`${riceRg} rg`);
    if (riceLg > 0) parts.push(`${riceLg} lg`);
    if (riceXl > 0) parts.push(`${riceXl} xl`);
    return parts.length > 0 ? parts.join(' + ') : '';
  };

  const getSideDishSummary = () => {
    if (nonVegCustomSplit) {
      const mwfText = formatDayProfile({ dal: dalCount, chicken: chickenCount, sabji: sabjiCount });
      const tth = tthProfileForMode();
      const tthText = isDoubleDalTTh(tth) ? '2 Dal' : formatDayProfile(tth);
      let summary = `M/W/F: ${mwfText} | Tue/Thu: ${tthText}`;
      if (saladCount > 0) summary += ` + ${formatSideAddon(saladCount, 'Salad')}`;
      if (dessertCount > 0) summary += ` + ${formatSideAddon(dessertCount, 'Dessert')}`;
      return summary;
    }

    const isStandardNonVeg =
      mealType === 'Non-veg' &&
      !isHalfPortion(portionSize) &&
      vegDaySideMode === 'default' &&
      isStandardNonVegProfile(dalCount, sabjiCount, gravyCount, chickenCount);

    if (isStandardNonVeg) {
      let summary = 'M/W/F: 1 Sabji + 1 Chicken | Tue/Thu: 1 Dal + 1 Sabji';
      if (saladCount > 0) summary += ` + ${formatSideAddon(saladCount, 'Salad')}`;
      if (dessertCount > 0) summary += ` + ${formatSideAddon(dessertCount, 'Dessert')}`;
      return summary;
    }

    const parts: string[] = [];
    if (dalCount > 0) parts.push(`${dalCount} Dal`);
    if (sabjiCount > 0) parts.push(`${sabjiCount} Sabji`);
    if (gravyCount > 0) parts.push(`${gravyCount} Gravy`);
    if (chickenCount > 0) parts.push(`${chickenCount} Chicken`);
    let summary = parts.join(' + ');
    if (saladCount > 0) summary += ` + ${formatSideAddon(saladCount, 'Salad')}`;
    if (dessertCount > 0) summary += ` + ${formatSideAddon(dessertCount, 'Dessert')}`;
    return summary || '';
  };

  const getScheduleSummary = () => {
    if (!fridayDoublePack) {
      const displaySchedule = formatSchedule(selectedDays);
      if (displaySchedule && displaySchedule !== 'Monday to Friday') return displaySchedule;
      return '';
    }
    // Saturday meal rides along with Friday → N Meals/wk with a Friday double pack.
    const weekdayCount = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].filter(d =>
      selectedDays.includes(d)
    ).length;
    const mealsPerWeek = weekdayCount + 1; // +1 for the Saturday meal delivered on Friday
    return `${mealsPerWeek} Meals/wk (Fri 2x)`;
  };

  const getSummaryString = () => {
    const pieces: string[] = [];
    if (mealType) pieces.push(mealType);
    if (portionSize) pieces.push(portionSize);
    if (rotiCount !== '' && Number(rotiCount) > 0) pieces.push(`${rotiCount} Roti`);
    if (pronthiCount !== '' && Number(pronthiCount) > 0) pieces.push(`${pronthiCount} Pronthi`);
    const riceSummary = getRiceSummary();
    if (riceSummary) pieces.push(`${riceSummary} Rice`);
    const dishSummary = getSideDishSummary();
    if (dishSummary) pieces.push(dishSummary);

    const scheduleSummary = getScheduleSummary();
    if (scheduleSummary) pieces.push(scheduleSummary);

    return pieces.length > 0 ? pieces.join(' • ') : 'No parameters populated yet';
  };

  const totalVegCount = initialCustomers.filter(c => {
    const meal = (c.meal_type || '').toLowerCase();
    return meal.includes('veg') && !meal.includes('non');
  }).length;

  const totalNonVegCount = initialCustomers.filter(c => {
    const meal = (c.meal_type || '').toLowerCase();
    return meal.includes('non');
  }).length;

  // Renders the stacked NOTES cell: an amber custom-curry badge first, then the
  // manual/allergy note (dietary_notes) below it. Never mixes sides into notes.
  const renderNotesCell = (customer: Customer): React.ReactNode => {
    // Deterministic placeholder until mount — identical on server and first client
    // render — so no client-only markup can cause a hydration mismatch in this cell.
    if (!isMounted) {
      return <span className="text-gray-300">…</span>;
    }

    const side = parseSideDishAll(customer.delivery_instructions);
    const sideSummary = formatSideSummary(side);

    // Half plans always get their own "⚡ Custom" badge describing the single container.
    const isHalfCustomer = isHalfPortion(customer.portion_size);
    const halfNote = isHalfCustomer ? formatHalfContainerNote(side, customer.portion_size) : null;

    // Extra add-ons beyond this plan's default allowance (flagged independently of curries).
    const planDefaults = defaultSideCounts(
      customer.meal_type || 'Veg',
      normalizePortionToken(customer.portion_size)
    );
    const addonParts: string[] = [];
    if (side.salad > planDefaults.salad) addonParts.push(formatSideAddon(side.salad, 'Salad'));
    if (side.dessert > planDefaults.dessert) addonParts.push(formatSideAddon(side.dessert, 'Dessert'));
    const extraAddonText = addonParts.join(' + ');

    let customText: string | null = null;
    if (customer.is_custom_curry === true && !isHalfCustomer) {
      const weeklyConfig = parseWeeklyCurryConfig(customer.curry_config);
      if (weeklyConfig) {
        const mwf = normalizeDayProfile(weeklyConfig.mwf);
        const tth = normalizeDayProfile(weeklyConfig.tth);
        if (weeklyConfig.pattern_type === 'veg_fixed') {
          const extrasText = weeklyConfig.extras.length
            ? ` + ${weeklyConfig.extras.join(' + ')}`
            : '';
          customText = `${formatDayProfile(weeklyConfig.mwf)}${extrasText}`;
        } else {
          // Non-veg weekly rotation: list only the day groups that deviate from
          // their official default (both joined with " | " when customized).
          customText = formatCustomCurryBadge(mwf, tth);
        }
      } else {
        const storedConfig = (customer.curry_config || '').trim();
        customText = storedConfig || sideSummary || null;
      }
    } else if (
      sideSummary !== '' &&
      !isHalfPortion(customer.portion_size) &&
      deviatesCurryFromDefault(
        customer.meal_type || 'Veg',
        normalizePortionToken(customer.portion_size),
        side
      )
    ) {
      customText = sideSummary;
    }

    // Curry presets unchanged? Flag ONLY the extra add-on(s), e.g. "2x Salad".
    if (!customText && !isHalfCustomer && extraAddonText !== '') {
      customText = extraAddonText;
    }

    const note =
      customer.dietary_notes && customer.dietary_notes.trim()
        ? customer.dietary_notes.trim()
        : null;

    // Never repeat a phrase that the amber custom badge already displays
    // (e.g. don't show both "Custom: 2 Gravy" and "⚠️ 2 Gravy").
    const displayNote = note ? dedupeRedundantNote(halfNote ?? customText, note) : null;

    // Full visible badge label. Day-group-led texts (M/W/F: / T/Th:) get a plain
    // "⚡" prefix; everything else keeps the explanatory "⚡ Custom:" prefix.
    const customBadgeLabel =
      customText &&
      (customText.startsWith('M/W/F:') || customText.startsWith('T/Th:')
        ? `⚡ ${customText}`
        : `⚡ Custom: ${customText}`);

    if (!halfNote && !customText && !displayNote) {
      return <span className="text-gray-300">—</span>;
    }

    return (
      <div className="flex flex-col items-start gap-1 min-w-0">
        {halfNote && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap"
            title={halfNote}
          >
            <span className="text-amber-500">⚡</span>
            {halfNote}
          </span>
        )}
        {customText && (
          <span
            className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-[10.5px] font-bold leading-snug truncate max-w-full inline-block"
            title={customBadgeLabel ?? undefined}
          >
            {customBadgeLabel}
          </span>
        )}
        {displayNote && (
          <span
            className="px-2 py-0.5 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md text-[10.5px] font-medium leading-snug"
            title={displayNote}
          >
            ⚠️ {displayNote}
          </span>
        )}
      </div>
    );
  };

  // ── Cancelled view helpers ──────────────────────────────────────
  const formatCancelledDate = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleReactivate = (customer: Customer) => {
    startTransition(async () => {
      try {
        await reactivateCustomer(customer.id);
        if (selectedCustomer?.id === customer.id) {
          setSelectedCustomer({ ...selectedCustomer, subscription_status: 'active' });
        }
        showToast(`${customer.full_name} reactivated successfully`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to reactivate customer', 'error');
      }
    });
  };

  // Convert an ISO/timestamp value to a YYYY-MM-DD input value.
  const toDateInputValue = (value: string | null | undefined): string => {
    if (!value) return '';
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const openCancellationDetails = (customer: Customer) => {
    setCancellationDetailsCustomer(customer);
    setCancelDetailDate(
      toDateInputValue(customer.cancelled_at) || toDateInputValue(new Date().toISOString())
    );
    setCancelDetailReason(customer.cancellation_reason || '');
    setShowCancellationDetails(true);
  };

  const closeCancellationDetails = () => {
    setShowCancellationDetails(false);
    setCancellationDetailsCustomer(null);
  };

  const handleSaveCancellationDetails = () => {
    if (!cancellationDetailsCustomer) return;
    startTransition(async () => {
      try {
        const cancelledAt = cancelDetailDate
          ? new Date(`${cancelDetailDate}T00:00:00`).toISOString()
          : new Date().toISOString();
        await updateCancellationDetails(
          cancellationDetailsCustomer.id,
          cancelledAt,
          cancelDetailReason.trim() || null
        );
        if (selectedCustomer?.id === cancellationDetailsCustomer.id) {
          setSelectedCustomer({
            ...selectedCustomer,
            cancelled_at: cancelledAt,
            cancellation_reason: cancelDetailReason.trim() || null,
          });
        }
        showToast('Cancellation details saved');
        closeCancellationDetails();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to save cancellation details', 'error');
      }
    });
  };

  const handleModalReactivate = () => {
    if (!cancellationDetailsCustomer) return;
    startTransition(async () => {
      try {
        await reactivateCustomer(cancellationDetailsCustomer.id);
        if (selectedCustomer?.id === cancellationDetailsCustomer.id) {
          setSelectedCustomer({ ...selectedCustomer, subscription_status: 'active' });
        }
        showToast(`${cancellationDetailsCustomer.full_name} reactivated successfully`);
        closeCancellationDetails();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to reactivate customer', 'error');
      }
    });
  };

  const renderCancelledRow = (customer: Customer): React.ReactNode => {
    return (
      <tr
        key={customer.id}
        onClick={() => openCancellationDetails(customer)}
        className={`group transition-all duration-150 cursor-pointer ${
          selectedCustomer?.id === customer.id ? 'bg-[#F4F4FE]' : 'hover:bg-[#FAF9FF] bg-white'
        }`}
      >
        <td className="py-2 pl-4 pr-3 rounded-l-xl">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#11142D] text-[13px] truncate capitalize">{customer.full_name}</span>
              <span title="Cancelled" className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
            </div>
            {customer.delivery_address ? (
              <span className="text-[11px] text-[#7A7C87] font-medium truncate mt-0.5 flex items-center">
                <span className="text-[9px] mr-1 opacity-70">📍</span>
                {customer.delivery_address.split(',')[0]}
              </span>
            ) : (
              <span className="text-[11px] text-gray-300 italic mt-0.5">No destination configured</span>
            )}
          </div>
        </td>

        <td className="py-2 pr-3 align-top whitespace-nowrap">
          {customer.cancelled_at ? (
            <span
              className="text-[12px] text-gray-600 font-semibold"
              title={`${new Date(customer.cancelled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${new Date(customer.cancelled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            >
              {formatCancelledDate(customer.cancelled_at)}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>

        <td className="py-2 pr-3 align-top break-words">
          {customer.cancellation_reason ? (
            <span className="text-[12.5px] text-slate-600 leading-normal font-normal">
              {customer.cancellation_reason}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>

        <td className="py-2 pr-3 rounded-r-xl text-right align-top whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              title="Edit cancellation details"
              aria-label="Edit cancellation details"
              onClick={(e) => {
                e.stopPropagation();
                openCancellationDetails(customer);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 stroke-[1.75]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleReactivate(customer);
              }}
              className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              Reactivate
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // Simplified 4-column table used when the STATUS filter is "CANCELLED".
  const renderCancelledTableInner = (): React.ReactNode => (
    <>
      <colgroup>
        <col className="w-[32%]" />
        <col className="w-[18%]" />
        <col className="w-[35%]" />
        <col className="w-[15%]" />
      </colgroup>
      <thead className="sticky top-0 z-20 bg-[#FCFCFD] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]">
        <tr className="text-[#A2A4B0] font-bold border-b border-[#EAEBED] uppercase text-[10.5px] tracking-wider select-none bg-[#FCFCFD] h-10">
          <th className="sticky top-0 z-20 bg-[#FCFCFD] pl-4 rounded-l-lg pb-1">Customer</th>
          <th className="sticky top-0 z-20 bg-[#FCFCFD] pb-1">Cancelled Date</th>
          <th className="sticky top-0 z-20 bg-[#FCFCFD] pb-1">Reason</th>
          <th className="sticky top-0 z-20 bg-[#FCFCFD] pb-1 pr-3 rounded-r-lg text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F9FBFC]">
        {sortedCustomers.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-16 text-center">
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 bg-[#F4F4FE] rounded-full flex items-center justify-center text-xl">🗂️</div>
                <h3 className="text-gray-700 font-bold text-[14px]">No cancelled customers found</h3>
                <p className="text-gray-400 text-xs max-w-xs leading-normal">
                  Cancelled customers will appear here so they can be reviewed or reactivated.
                </p>
              </div>
            </td>
          </tr>
        ) : (
          sortedCustomers.map(customer => renderCancelledRow(customer))
        )}
      </tbody>
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-[#FDFDFD] overflow-hidden font-sans antialiased text-[#292D32]">

      {/* 3-PART HEADER: Title/Count · Center Search · Add Customer */}
      <div className="px-8 py-4 shrink-0 flex items-center justify-between gap-6 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {/* LEFT: Title + Count Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-[22px] font-bold text-[#11142D] tracking-tight">Customers</h1>
          <span className="inline-flex items-center justify-center px-2.5 py-0.5 bg-[#F4F5F7] border border-[#E5E7EB] text-[#5E6470] text-xs font-semibold rounded-full min-w-[28px]">
            {filteredCustomers.length}
          </span>
        </div>

        {/* CENTER: Prominent Centered Search Bar */}
        <div className="flex-1 max-w-xl mx-auto">
          <div className="relative w-full">
            {/* Icon Container with z-10 and pointer-events-none */}
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none z-10">
              <svg
                className="w-4 h-4 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search customer, address, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-[13px] pl-10 pr-9 py-2 bg-[#F9FBFC] border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] focus:bg-white text-[#292D32] placeholder-gray-400 transition-all shadow-sm"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 text-sm cursor-pointer z-10"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: Kitchen Dispatch toggle + Primary CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-pressed={kitchenMode}
            onClick={toggleKitchenMode}
            title="Kitchen Dispatch / Packing Order: Non-Veg first → Large → Regular → Small → A–Z"
            className={`flex items-center space-x-1.5 px-3 py-2 text-[13px] font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              kitchenMode
                ? 'bg-[#5D5FEF] border-[#5D5FEF] text-white'
                : 'bg-white border-[#E0E0E0] text-[#7A7C87] hover:bg-gray-50'
            }`}
          >
            <span>🍳</span>
            <span>Kitchen Order</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddForm}
            className="px-4 py-2 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-[13px] font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            + Add Customer
          </button>
        </div>
      </div>

      {/* CONSOLIDATED FILTER BAR: dietary tabs (left) + status pills (right) */}
      <div className="px-8 pt-3 pb-3 shrink-0 border-b border-[#EEEEEE] flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-[13px] font-medium text-[#7A7C87] whitespace-nowrap">
          <button onClick={() => setActiveTab('all')} className={`pb-1 border-b-2 transition-colors ${activeTab === 'all' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            All Customers <span className="text-xs text-[#B5B7C0]">({initialCustomers.length})</span>
          </button>
          <button onClick={() => setActiveTab('veg')} className={`pb-1 border-b-2 transition-colors ${activeTab === 'veg' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            Vegetarian <span className="text-xs text-[#B5B7C0]">({totalVegCount})</span>
          </button>
          <button onClick={() => setActiveTab('non-veg')} className={`pb-1 border-b-2 transition-colors ${activeTab === 'non-veg' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            Non-Vegetarian <span className="text-xs text-[#B5B7C0]">({totalNonVegCount})</span>
          </button>
        </div>

        {/* SUBSCRIPTION STATUS FILTER PILLS */}
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-semibold text-[#A2A4B0] uppercase tracking-wider mr-1">Status:</span>
          {(['all', 'active', 'paused', 'cancelled'] as const).map(status => {
            const statusCounts: Record<string, number> = {
              all: initialCustomers.length,
              active: initialCustomers.filter(c => (c.subscription_status || 'active') === 'active').length,
              paused: initialCustomers.filter(c => c.subscription_status === 'paused').length,
              cancelled: initialCustomers.filter(c => c.subscription_status === 'cancelled').length,
            };
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all border ${
                  statusFilter === status
                    ? status === 'active'
                      ? 'bg-green-100 text-green-700 border-green-300'
                      : status === 'paused'
                        ? 'bg-amber-100 text-amber-700 border-amber-300'
                        : status === 'cancelled'
                          ? 'bg-red-100 text-red-700 border-red-300'
                          : 'bg-[#5D5FEF] text-white border-[#5D5FEF]'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {status === 'all' ? 'All' : status} ({statusCounts[status]})
              </button>
            );
          })}
        </div>
      </div>

      {/* DATA VIEW TABLE — only this list scrolls; headers stay fixed */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-3">
        <div className="w-full">
          <table className="w-full table-fixed text-left text-[13px] border-separate border-spacing-0">
            {statusFilter === 'cancelled' ? (
              renderCancelledTableInner()
            ) : (
              <>
                <colgroup>
              <col className="w-[23%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[13%]" />
              <col className="w-[18%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="sticky top-0 z-30">
              <tr className="text-[#A2A4B0] font-bold uppercase text-[10.5px] tracking-wider select-none h-10">
                <th onClick={cycleNameSort} className="sticky top-0 z-30 bg-[#FCFCFD] pl-4 pb-1 border-b border-[#EAEBED] cursor-pointer select-none hover:text-indigo-600 transition-colors group">
                  <div className="flex items-center space-x-1">
                    <span>Customer</span>
                    <span className="text-[10px] text-gray-400 font-bold opacity-70 group-hover:opacity-100">
                      {nameSort === 'default' ? ' ↕' : nameSort === 'asc' ? ' ↑' : ' ↓'}
                    </span>
                  </div>
                </th>
                <th onClick={cyclePortionSort} className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 border-b border-[#EAEBED] cursor-pointer select-none hover:text-indigo-600 transition-colors group">
                  <div className="flex items-center space-x-1">
                    <span>Meal Plan</span>
                    <span className="text-[10px] text-gray-400 font-bold opacity-70 group-hover:opacity-100">
                      {portionSort === 'default' ? ' ⇅' : portionSort === 'desc' ? ' ↓' : ' ↑'}
                    </span>
                  </div>
                </th>
                <th className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 border-b border-[#EAEBED]">Carbs</th>
                <th className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 border-b border-[#EAEBED]">Schedule</th>
                <th className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 border-b border-[#EAEBED]">Notes</th>
                <th className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 border-b border-[#EAEBED] text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Discount</th>
                <th className="sticky top-0 z-30 bg-[#FCFCFD] pb-1 pr-3 border-b border-[#EAEBED] text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F9FBFC]">
              {sortedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-12 h-12 bg-[#F4F4FE] rounded-full flex items-center justify-center text-xl">👥</div>
                      <h3 className="text-gray-700 font-bold text-[14px]">No customers found matching search</h3>
                      <p className="text-gray-400 text-xs max-w-xs leading-normal">Verify credentials or spin up a fresh active profile record instantly below.</p>
                      <button onClick={handleOpenAddForm} className="mt-1 px-4 py-1.5 bg-[#5D5FEF] text-white text-xs font-bold rounded-lg shadow-sm">
                        + Add Fresh Record
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedCustomers.map(customer => {
                  const displayPlanSize = normalizePortionToken(customer.portion_size || PORTION_RG);

                  // Pickup orders (address or name contains "PICKUP") show a badge instead of a map link.
                  const isPickupOrder =
                    (customer.delivery_address || '').toUpperCase().includes('PICKUP') ||
                    (customer.full_name || '').toUpperCase().includes('PICKUP');

                  return (
                    <tr
                      key={customer.id}
                      onClick={() => handleRowClick(customer)}
                      className={`group transition-colors cursor-pointer ${selectedCustomer?.id === customer.id
                        ? 'bg-[#F4F4FE]'
                        : 'bg-white hover:bg-slate-50/80'
                        }`}
                    >
                      <td className="py-2 pl-4 pr-3 rounded-l-xl">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-[#11142D] text-[13px] truncate capitalize">{customer.full_name}</span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded border shrink-0 ${
                                TIER_BADGE_STYLES[customer.plan_tier || 'monthly']
                              }`}
                              title={
                                customer.start_date
                                  ? `${customer.plan_tier || 'Monthly'} (${customer.total_tiffin_credits ?? (customer.plan_tier === 'trial' ? 1 : customer.plan_tier === 'weekly' ? 5 : 20)}) · Starts ${formatStartDateLabel(customer.start_date)}`
                                  : undefined
                              }
                            >
                              {customer.plan_tier || 'Monthly'} ({customer.total_tiffin_credits ?? (customer.plan_tier === 'trial' ? 1 : customer.plan_tier === 'weekly' ? 5 : 20)})
                            </span>
                            {(() => {
                              const subStatus = (customer.subscription_status || 'active').toLowerCase();
                              const isPaused = subStatus === 'paused';
                              const isCancelled = subStatus === 'cancelled';
                              const statusLabel = isCancelled
                                ? `Cancelled${customer.cancellation_reason ? ` — ${customer.cancellation_reason}` : ''}`
                                : isPaused
                                  ? `Paused${customer.pause_start_date ? ` until ${customer.pause_end_date || 'Indefinite'}` : ''}`
                                  : 'Active';
                              return (
                                <span
                                  title={statusLabel}
                                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                                    isCancelled ? 'bg-red-500' : isPaused ? 'bg-amber-400' : 'bg-green-500'
                                  }`}
                                />
                              );
                            })()}
                          </div>
                          {isPickupOrder ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 mt-0.5">
                              🛍️ Kitchen Pickup
                            </span>
                          ) : customer.delivery_address ? (
                            <div className="flex items-center min-w-0 mt-0.5 max-w-full">
                              <span
                                className="text-[11px] text-[#7A7C87] font-medium truncate"
                                title={customer.delivery_address}
                              >
                                {customer.delivery_address.split(',')[0]}
                              </span>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.delivery_address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in Google Maps"
                                aria-label="Open in Google Maps"
                                onClick={(e) => e.stopPropagation()}
                                className="ml-1 p-0.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors inline-flex items-center"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-300 italic mt-0.5">No destination configured</span>
                          )}
                        </div>
                      </td>

                      <td className="py-2 pr-3 whitespace-nowrap align-top">
                        <div className="flex flex-col items-start gap-1">
                          {customer.meal_type ? (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border tracking-wide uppercase leading-none ${
                              customer.meal_type.toLowerCase().includes('non')
                                ? 'bg-red-50 text-red-600 border-red-100/60'
                                : 'bg-green-50 text-green-600 border-green-100/60'
                            }`}>
                              {customer.meal_type.toLowerCase().includes('non') ? 'Non-Veg' : 'Veg'}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300 font-bold uppercase">—</span>
                          )}
                          <span className={`text-[11px] font-semibold ${
                            displayPlanSize === PORTION_LG || displayPlanSize === PORTION_HALF_LG ? 'text-purple-600' : 'text-gray-500'
                          }`}>
                            {displayPlanSize}
                          </span>
                        </div>
                      </td>

                      <td className="py-2 pr-3 align-top">
                        {(() => {
                          const hasRoti =
                            customer.roti_count !== null &&
                            customer.roti_count !== undefined &&
                            customer.roti_count > 0;
                          const hasPronthi =
                            customer.pronthi_count !== null &&
                            customer.pronthi_count !== undefined &&
                            customer.pronthi_count > 0;
                          const rawRice = (customer.rice_count || '').trim().toLowerCase();
                          const hasRice =
                            rawRice !== '' &&
                            rawRice !== 'none' &&
                            rawRice !== '—' &&
                            rawRice !== '0' &&
                            !rawRice.includes('0 rg');
                          if (!hasRoti && !hasPronthi && !hasRice) {
                            return <span className="text-gray-300 font-mono">—</span>;
                          }
                          return (
                            <div className="flex flex-col items-start gap-1">
                              {hasRoti && (
                                <span className="px-1.5 py-0.5 bg-amber-50/80 text-amber-800 border border-amber-100 rounded text-[10.5px] font-bold font-mono whitespace-nowrap">
                                  {customer.roti_count} Roti
                                </span>
                              )}
                              {hasPronthi && (
                                <span className="px-1.5 py-0.5 bg-orange-50 text-orange-800 border border-orange-200 rounded text-[10.5px] font-bold font-mono whitespace-nowrap">
                                  {customer.pronthi_count} Pronthi
                                </span>
                              )}
                              {hasRice && (
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100/70 rounded text-[10.5px] font-bold font-mono uppercase whitespace-nowrap">
                                  {formatRiceCellText(customer.rice_count)} Rice
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      <td className="py-2 pr-3 align-top whitespace-nowrap">
                        {(() => {
                          const badgeText = getScheduleBadgeText(customer);
                          return badgeText ? (
                            <span
                              className="inline-flex px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-gray-700 text-[10.5px] font-bold tracking-wide whitespace-nowrap"
                              title={getScheduleTooltip(customer) || undefined}
                            >
                              {badgeText}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          );
                        })()}
                      </td>

                      <td className="py-2 pr-3 align-top break-words">
                        {renderNotesCell(customer)}
                      </td>

                      <td className="py-2 px-3 text-center align-middle whitespace-nowrap">
                        {!customer.discount_type ||
                        customer.discount_type === 'none' ||
                        !customer.discount_value ||
                        Number(customer.discount_value) === 0 ? (
                          <span className="text-gray-300 font-medium">—</span>
                        ) : (
                          <span
                            title={customer.discount_note || 'Discount applied'}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
                          >
                            {customer.discount_type === 'percent'
                              ? `-${customer.discount_value}%`
                              : `-$${customer.discount_value}`}
                          </span>
                        )}
                      </td>

                      <td className="py-2 pr-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1.5 relative">
                          {/* Edit Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditCustomer(customer);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:text-indigo-600 hover:bg-gray-100 rounded-md transition-colors"
                          >
                            Edit
                          </button>

                          {/* 3-Dot Overflow Menu */}
                          <div
                            className="relative inline-block text-left"
                            data-action-menu={customer.id}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all shrink-0 cursor-pointer shadow-xs"
                              title="More options"
                              aria-label="More actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === customer.id ? null : customer.id);
                              }}
                            >
                              <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 20 20">
                                <circle cx="10" cy="4" r="1.3" />
                                <circle cx="10" cy="10" r="1.3" />
                                <circle cx="10" cy="16" r="1.3" />
                              </svg>
                            </button>

                            {activeMenuId === customer.id && (
                              <div
                                className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-100 rounded-xl shadow-xl py-1.5 z-50 text-left"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                {/* Pause / Resume */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    if ((customer.subscription_status || 'active') === 'paused') {
                                      handleUpdateCustomerStatus(customer.id, 'active');
                                    } else {
                                      openConfirmModalForCustomer(customer, 'pause');
                                    }
                                  }}
                                  className="w-full px-3.5 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                                >
                                  <span className="text-sm shrink-0">
                                    {(customer.subscription_status || 'active') === 'paused' ? '▶️' : '⏸️'}
                                  </span>
                                  <span className="whitespace-nowrap">
                                    {(customer.subscription_status || 'active') === 'paused' ? 'Resume Service' : 'Pause Service'}
                                  </span>
                                </button>

                                {/* Cancel */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    openConfirmModalForCustomer(customer, 'cancel');
                                  }}
                                  className="w-full px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                                >
                                  <span className="text-sm shrink-0">🛑</span>
                                  <span className="whitespace-nowrap">Cancel Service</span>
                                </button>

                                <div className="border-t border-gray-100 my-1" />

                                {/* Delete */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    openConfirmModalForCustomer(customer, 'delete');
                                  }}
                                  className="w-full px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                                >
                                  <span className="text-sm shrink-0">🗑️</span>
                                  <span className="whitespace-nowrap">Delete Customer</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
              </>
            )}
          </table>
        </div>

        {/* FLUID SLIDING DRAWER SYSTEM */}
        {isPanelRendered && (
          <>
            <div
              onClick={closePanelGracefully}
              className={`fixed inset-0 z-20 bg-black/10 transition-opacity duration-200 ${isSlideInActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            />

            <div
              className={`w-full md:w-[640px] lg:w-[700px] h-full bg-white border-l border-[#EEEEEE] flex flex-col shadow-2xl fixed right-0 top-0 bottom-0 z-30 transform transition-transform duration-200 ease-out ${isSlideInActive ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
              <form onSubmit={handleFormSubmit} className="flex-1 flex flex-col overflow-hidden text-[13px]">

                {/* HEAD BAR ACTIONS */}
                <div className="px-6 py-4 border-b border-[#F5F5F5] flex items-center justify-between bg-[#FCFCFD] shrink-0">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <h2 className="text-[14px] font-bold text-[#11142D] uppercase tracking-wide shrink-0">
                      {isAddingNew ? 'Add Customer' : 'Edit'}
                    </h2>
                    {!isAddingNew && fullName && (
                      <>
                        <span className="text-2xl font-bold text-gray-900 capitalize truncate">
                          {fullName}
                        </span>
                        {selectedCustomer && (
                          <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border tracking-wide uppercase shrink-0 ${
                            (selectedCustomer.subscription_status || 'active') === 'cancelled'
                              ? 'bg-red-50 text-red-600 border-red-100/60'
                              : (selectedCustomer.subscription_status || 'active') === 'paused'
                                ? 'bg-amber-50 text-amber-600 border-amber-100/60'
                                : 'bg-green-50 text-green-600 border-green-100/60'
                          }`}>
                            {(selectedCustomer.subscription_status || 'active') === 'cancelled' ? '🔴 Cancelled' :
                             (selectedCustomer.subscription_status || 'active') === 'paused' ? '🟡 Paused' :
                             '🟢 Active'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button type="button" onClick={closePanelGracefully} className="px-3 py-1.5 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50">
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={isPending || aiLoading} 
                      className={`px-3 py-1.5 font-semibold rounded-lg text-xs shadow-sm transition-all duration-200 flex items-center space-x-1.5 ${
                        aiLoading 
                          ? 'bg-[#EFEEFC] text-[#5D5FEF] border border-[#EFEEFC] cursor-wait' 
                          : 'bg-[#5D5FEF] hover:bg-[#4D4FDF] text-white disabled:opacity-50'
                      }`}
                    >
                      {(isPending || aiLoading) && (
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      <span>
                        {aiLoading 
                          ? 'Waiting for Profile Analysis...' 
                          : isPending 
                            ? 'Committing to Database...' 
                            : 'Save Customer'
                        }
                      </span>
                    </button>
                  </div>
                </div>

                {/* SCROLLABLE INTERFACE WORKSPACE */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">

                  {/* BASE DATA INPUT FIELDS — compact 2-row grid */}
                  <div className="space-y-3">
                    {/* Row 1: Full Name + Contact Method (side by side) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">Full Name</label>
                        <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF]" />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                          Contact Method <span className="text-gray-400 font-normal normal-case">(Optional)</span>
                        </label>
                        <div className="flex items-stretch">
                          <select
                            value={contactChannel}
                            onChange={(e) => setContactChannel(e.target.value as ContactChannel)}
                            title="Contact channel"
                            className="shrink-0 rounded-l-lg border border-r-0 border-[#E0E0E0] bg-gray-50 text-gray-600 text-[11px] font-semibold outline-none focus:border-[#5D5FEF] px-1.5 py-1.5 cursor-pointer"
                          >
                            <option value="phone">📞 Phone</option>
                            <option value="messenger">💬 Messenger</option>
                            <option value="whatsapp">📱 WhatsApp</option>
                          </select>
                          <input
                            type="text"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder={
                              contactChannel === 'messenger'
                                ? 'Profile name or m.me link'
                                : contactChannel === 'whatsapp'
                                  ? 'WhatsApp number'
                                  : 'e.g. +1 (226) 555-0199'
                            }
                            className="w-full min-w-0 rounded-r-lg px-3 py-1.5 border border-[#E0E0E0] outline-none focus:border-[#5D5FEF]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Delivery destination address (full width) */}
                    <div ref={addressContainerRef} className="relative">
                      <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                        Delivery Destination Address
                      </label>
                      <input
                        type="text"
                        value={deliveryAddress}
                        onChange={(e) => handleAddressChange(e.target.value)}
                        required
                        placeholder="Type address..."
                        className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF]"
                      />

                      {/* FLOATING GEOGRAPHIC SUGGESTIONS DROPDOWN BLOCK */}
                      {addressSuggestions.length > 0 && (
                        <ul className="absolute left-0 right-0 mt-1 bg-white border border-[#EEEEEE] rounded-lg shadow-xl max-h-48 overflow-y-auto z-50 text-[12px] divide-y divide-gray-50">
                          {addressSuggestions.map((suggestion, index) => (
                            <li
                              key={index}
                              onClick={() => {
                                setDeliveryAddress(suggestion);
                                setAddressSuggestions([]);
                              }}
                              className="px-3 py-2 hover:bg-[#F4F4FE] hover:text-[#5D5FEF] cursor-pointer truncate transition-colors font-medium text-gray-600"
                            >
                              📍 {suggestion}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* LOADING SPINNER THREAD BADGE */}
                      {isAddressLoading && (
                        <span className="absolute right-3 top-[30px] text-[10px] text-purple-400 animate-pulse font-bold tracking-wider uppercase">
                          Searching...
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ═════ COMPACT SUBSCRIPTION PLAN ═════ */}
                  <div className="space-y-2.5 pt-1 border-t border-gray-100">
                    <span className="text-[11px] font-bold text-gray-400 tracking-wider uppercase">Subscription Plan</span>

                    {/* 3-Segment Horizontal Pill Selector */}
                    <div className="grid grid-cols-3 gap-2">
                      {PLAN_OPTIONS.map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            setPlanTier(opt.key);
                            setTotalTiffinCredits(opt.credits);
                          }}
                          className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all text-center cursor-pointer ${
                            planTier === opt.key
                              ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-xs'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span className="capitalize">{opt.label}</span>
                          <span className="text-[10px] opacity-75 font-normal ml-1">({opt.credits})</span>
                        </button>
                      ))}
                    </div>

                    {/* Side-by-side Credits Stepper + Start Date */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">
                          Credits (Override)
                        </label>
                        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden h-8 bg-white">
                          <button
                            type="button"
                            onClick={() => setTotalTiffinCredits(Math.max(1, totalTiffinCredits - 1))}
                            className="px-2.5 h-full bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-r border-gray-200"
                          >−</button>
                          <span className="flex-1 text-center text-xs font-bold text-gray-800">
                            {totalTiffinCredits}
                          </span>
                          <button
                            type="button"
                            onClick={() => setTotalTiffinCredits(totalTiffinCredits + 1)}
                            className="px-2.5 h-full bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-l border-gray-200"
                          >+</button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">
                          Start Date (Optional)
                        </label>
                        <input
                          type="date"
                          value={startDate || ''}
                          onChange={e => setStartDate(e.target.value)}
                          className="w-full h-8 px-2 text-xs border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-blue-500 bg-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ═════ DIETARY CONFIGURATION — PREMIUM FORM ═════ */}
                  <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dietary Configuration</span>
                      <span className="block text-[11px] text-blue-600 font-medium mt-0.5">
                        📋 {getSummaryString()}
                      </span>
                    </div>

                    <div className="p-5 space-y-5">
                      {/* GRID ROW 1: Meal Type + Portion Size */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="min-w-0">
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Meal Type</label>
                          <div className="flex gap-2">
                            {['Veg', 'Non-veg'].map(option => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => handleMealTypeChange(option)}
                                className={`flex-1 h-10 px-3 rounded-lg text-xs font-semibold border transition-all ${
                                  mealType === option
                                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Portion Size</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: 'RG', value: PORTION_RG, title: 'RG — Full Regular (2x 8oz containers)' },
                              { label: 'LG', value: PORTION_LG, title: 'LG — Full Large (2x 12oz containers)' },
                              { label: 'Half RG', value: PORTION_HALF_RG, title: 'Half RG — Single 8oz container' },
                              { label: 'Half LG', value: PORTION_HALF_LG, title: 'Half LG — Single 12oz container' },
                            ].map(opt => (
                              <button
                                key={opt.value}
                                type="button"
                                title={opt.title}
                                onClick={() => handlePortionChange(opt.value)}
                                className={`flex-1 h-9 px-2 rounded-lg text-xs font-semibold border transition-all ${
                                  portionSize === opt.value
                                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* GRID ROW 2: Roti Count + Curries / Dal Allocation */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Bread Counts — Roti & Pronthi steppers */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Roti Stepper */}
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Roti</label>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setRotiCount(Math.max(0, (rotiCount === '' ? 0 : Number(rotiCount)) - 1))}
                                className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                              >−</button>
                              <input
                                type="number"
                                min={0}
                                value={rotiCount}
                                onChange={(e) => setRotiCount(e.target.value ? parseInt(e.target.value) : '')}
                                className="w-12 h-8 text-center px-0 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm font-semibold text-gray-700"
                              />
                              <button
                                type="button"
                                onClick={() => setRotiCount((rotiCount === '' ? 0 : Number(rotiCount)) + 1)}
                                className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                              >+</button>
                            </div>
                          </div>

                          {/* Pronthi Stepper */}
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Pronthi</label>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPronthiCount(Math.max(0, (pronthiCount === '' ? 0 : Number(pronthiCount)) - 1))}
                                className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                              >−</button>
                              <input
                                type="number"
                                min={0}
                                value={pronthiCount}
                                onChange={(e) => setPronthiCount(e.target.value ? parseInt(e.target.value) : '')}
                                className="w-12 h-8 text-center px-0 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm font-semibold text-gray-700"
                              />
                              <button
                                type="button"
                                onClick={() => setPronthiCount((pronthiCount === '' ? 0 : Number(pronthiCount)) + 1)}
                                className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                              >+</button>
                            </div>
                          </div>
                        </div>

                        {/* Curries / Dal — curry steppers + weekly non-veg pattern selector */}
                        <div className="min-w-0">
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            Curries / Dal
                            {portionSize && (
                              <span className="text-[10px] text-gray-400 font-normal normal-case ml-1">
                                ({totalCurryCount}/{curryContainerLimit} containers/day)
                              </span>
                            )}
                          </label>
                          <div className="bg-white border border-gray-100 rounded-lg p-3 space-y-2">
                            {/* ── Non-Veg weekly day split (RG / LG) ── */}
                            {mealType === 'Non-veg' && !isHalfPortion(portionSize) && (
                              <div className="space-y-3">
                                {/* Row 1: M/W/F quick pills */}
                                <div>
                                  <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                    Mon, Wed, Fri (Non-Veg Days)
                                  </span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {([
                                      { key: 'default', label: '1 Sabji + 1 Chicken (Default)' },
                                      { key: 'dal-chicken', label: '1 Dal + 1 Chicken' },
                                      { key: 'double-chicken', label: '2x Chicken' },
                                      { key: 'double-gravy', label: '2x Gravy' },
                                      { key: 'custom', label: 'Custom' },
                                    ] as const).map(opt => (
                                      <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => {
                                          if (opt.key === 'custom') {
                                            setMwfSideMode('custom');
                                            return;
                                          }
                                          const preset = MWF_PRESETS[opt.key];
                                          setDalCount(preset.dal);
                                          setSabjiCount(preset.sabji);
                                          setChickenCount(preset.chicken);
                                          setGravyCount(preset.gravy || 0);
                                          setMwfSideMode(opt.key);
                                        }}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold border transition-all ${
                                          mwfSideMode === opt.key
                                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  {mwfSideMode === 'custom' && (
                                    <div className="mt-2 space-y-1.5">
                                      {[
                                        { label: 'Dal', key: 'dal' as const, count: dalCount, set: setDalCount, color: 'text-amber-700' },
                                        { label: 'Sabji', key: 'sabji' as const, count: sabjiCount, set: setSabjiCount, color: 'text-green-700' },
                                        { label: 'Chicken', key: 'chicken' as const, count: chickenCount, set: setChickenCount, color: 'text-red-600' },
                                        { label: 'Gravy', key: 'gravy' as const, count: gravyCount, set: setGravyCount, color: 'text-orange-600' },
                                      ].map(item => (
                                        <div key={item.key} className="flex items-center gap-2 bg-white rounded-md border border-gray-100 px-3 py-1.5">
                                          <span className={`text-xs font-semibold uppercase shrink-0 ${item.color}`}>{item.label}</span>
                                          <div className="flex items-center gap-1 ml-auto">
                                            <button
                                              type="button"
                                              onClick={() => item.set(Math.max(0, item.count - 1))}
                                              disabled={item.count === 0}
                                              className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 text-sm flex items-center justify-center shrink-0"
                                            >−</button>
                                            <span className="w-7 text-center font-semibold text-sm text-gray-700">{item.count}</span>
                                            <button
                                              type="button"
                                              onClick={() => item.set(item.count + 1)}
                                              className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 text-sm flex items-center justify-center shrink-0"
                                            >+</button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>


                                {/* Row 2: Tue/Thu quick pills */}
                                <div>
                                  <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                    Tue, Thu (Veg Days)
                                  </span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {([
                                      { key: 'default', label: '1 Dal + 1 Sabji (Default)' },
                                      { key: 'double-dal', label: '2x Dal (No Sabji)' },
                                      { key: 'double-sabji', label: '2x Sabji (No Dal)' },
                                      { key: 'custom', label: 'Custom' },
                                    ] as const).map(opt => (
                                      <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => {
                                          if (opt.key === 'custom') {
                                            setVegDaySideMode('custom');
                                            return;
                                          }
                                          const preset = TTH_PRESETS[opt.key];
                                          setTthDal(preset.dal);
                                          setTthSabji(preset.sabji);
                                          setTthChicken(preset.chicken);
                                          setTthGravy(preset.gravy || 0);
                                          setVegDaySideMode(opt.key);
                                        }}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold border transition-all ${
                                          vegDaySideMode === opt.key
                                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  {vegDaySideMode === 'custom' && (
                                    <div className="mt-2 space-y-1.5">
                                      {[
                                        { label: 'Dal', key: 'dal' as const, count: tthDal, set: setTthDal, color: 'text-amber-700' },
                                        { label: 'Sabji', key: 'sabji' as const, count: tthSabji, set: setTthSabji, color: 'text-green-700' },
                                      ].map(item => (
                                        <div key={item.key} className="flex items-center gap-2 bg-white rounded-md border border-gray-100 px-3 py-1.5">
                                          <span className={`text-xs font-semibold uppercase shrink-0 ${item.color}`}>{item.label}</span>
                                          <div className="flex items-center gap-1 ml-auto">
                                            <button
                                              type="button"
                                              onClick={() => item.set(Math.max(0, item.count - 1))}
                                              disabled={item.count === 0}
                                              className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 text-sm flex items-center justify-center shrink-0"
                                            >−</button>
                                            <span className="w-7 text-center font-semibold text-sm text-gray-700">{item.count}</span>
                                            <button
                                              type="button"
                                              onClick={() => item.set(item.count + 1)}
                                              className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 text-sm flex items-center justify-center shrink-0"
                                            >+</button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* ── Veg (and unselected type) curry steppers ── */}
                            {mealType !== 'Non-veg' && !isHalfPortion(portionSize) && (
                              <div className="space-y-1.5">
                                {[
                                  { label: 'Dal', key: 'dal' as const, count: dalCount, color: 'text-amber-700' },
                                  { label: 'Sabji', key: 'sabji' as const, count: sabjiCount, color: 'text-green-700' },
                                ].map(item => (
                                  <div key={item.key} className="flex items-center gap-2 bg-white rounded-md border border-gray-100 px-3 py-1.5">
                                    <span className={`text-xs font-semibold uppercase shrink-0 ${item.color}`}>{item.label}</span>
                                    <div className="flex items-center gap-1 ml-auto">
                                      <button
                                        type="button"
                                        onClick={() => { if (item.count > 0) applySideCountChange(item.key, item.count - 1); }}
                                        disabled={item.count === 0}
                                        className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 text-sm flex items-center justify-center shrink-0"
                                      >−</button>
                                      <span className="w-7 text-center font-semibold text-sm text-gray-700">{item.count}</span>
                                      <button
                                        type="button"
                                        onClick={() => { if (totalCurryCount < curryContainerLimit) applySideCountChange(item.key, item.count + 1); }}
                                        disabled={totalCurryCount >= curryContainerLimit}
                                        className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 text-sm flex items-center justify-center shrink-0"
                                      >+</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* ── Half portion profile: single-select toggle ── */}
                            {isHalfPortion(portionSize) && (
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { label: 'Dal', key: 'dal', active: dalCount === 1 },
                                  { label: 'Sabji', key: 'sabji', active: sabjiCount === 1 },
                                  ...(mealType === 'Non-veg' ? [
                                    { label: 'Chicken', key: 'chicken', active: chickenCount === 1 },
                                    { label: 'Gravy', key: 'gravy', active: gravyCount === 1 },
                                  ] : []),
                                ].map(item => (
                                  <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => {
                                      setDalCount(item.key === 'dal' ? 1 : 0);
                                      setSabjiCount(item.key === 'sabji' ? 1 : 0);
                                      setChickenCount(item.key === 'chicken' ? 1 : 0);
                                      setGravyCount(item.key === 'gravy' ? 1 : 0);
                                    }}
                                    className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-all ${
                                      item.active
                                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >1 {item.label}</button>
                                ))}
                              </div>
                            )}


                            {/* Add-ons section — Salad & Dessert count steppers */}
                            <div className="flex items-center justify-center gap-3 pt-2 border-t border-gray-100">
                              {/* Salad Stepper */}
                              <div className="flex items-center border rounded-lg overflow-hidden text-xs bg-white">
                                <button
                                  type="button"
                                  onClick={() => setSaladCount(Math.max(0, saladCount - 1))}
                                  className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-r"
                                >−</button>
                                <span className="px-2.5 py-1 font-medium text-emerald-800 bg-emerald-50/50 flex items-center gap-1 select-none">
                                  🥗 Salad {saladCount > 1 ? `(${saladCount})` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSaladCount(saladCount + 1)}
                                  className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-l"
                                >+</button>
                              </div>

                              {/* Dessert Stepper */}
                              <div className="flex items-center border rounded-lg overflow-hidden text-xs bg-white">
                                <button
                                  type="button"
                                  onClick={() => setDessertCount(Math.max(0, dessertCount - 1))}
                                  className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-r"
                                >−</button>
                                <span className="px-2.5 py-1 font-medium text-pink-800 bg-pink-50/50 flex items-center gap-1 select-none">
                                  🍰 Dessert {dessertCount > 1 ? `(${dessertCount})` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setDessertCount(dessertCount + 1)}
                                  className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-l"
                                >+</button>
                              </div>
                            </div>
                          </div>
                          {(customCurryPillText || extraAddonNote) && (
                            <div className="mt-1 p-2.5 bg-orange-50 border border-orange-200 text-orange-600 text-xs font-semibold rounded-md flex items-center gap-2">
                              ⚡ Custom: {customCurryPillText || extraAddonNote}
                            </div>
                          )}
                          {customHalfNote && (
                            <div className="mt-3 px-3.5 py-2 bg-amber-50/90 border border-amber-200 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                              <span className="text-amber-500">⚡</span>
                              <span>{customHalfNote}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ROW 3: Rice Portion */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Rice Portion</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { key: 'rg', label: 'Regular', val: riceRg, set: setRiceRg },
                            { key: 'lg', label: 'Large', val: riceLg, set: setRiceLg },
                            { key: 'xl', label: 'XL', val: riceXl, set: setRiceXl },
                          ].map(rice => (
                            <div key={rice.key} className="bg-white border border-gray-100 rounded-lg p-3 w-full flex flex-col items-center justify-center gap-3">
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{rice.label}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => rice.set(Math.max(0, rice.val - 1))}
                                  className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 active:bg-gray-200 text-sm flex items-center justify-center transition-colors shrink-0"
                                >−</button>
                                <span className="w-8 text-center font-semibold text-sm text-gray-700">{rice.val}</span>
                                <button
                                  type="button"
                                  onClick={() => rice.set(rice.val + 1)}
                                  className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 active:bg-gray-200 text-sm flex items-center justify-center transition-colors shrink-0"
                                >+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ROW 4: Delivery Schedule — Day Toggle Buttons */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Delivery Schedule</label>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_DAYS.filter(day => day !== 'Sunday').map(day => {
                            const isSelected = selectedDays.includes(day);
                            // Friday stays locked-on whenever Saturday (Fri double pack) is selected.
                            const isLockedFriday = day === 'Friday' && fridayDoublePack;
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleScheduleDay(day)}
                                title={
                                  day === 'Friday' && fridayDoublePack
                                    ? 'Required while Saturday is selected (double pack on Friday)'
                                    : day === 'Saturday'
                                      ? 'Saturday meal is packed and delivered on Friday'
                                      : ''
                                }
                                className={`w-10 h-10 rounded-lg text-[11px] font-semibold border transition-all ${
                                  isSelected
                                    ? isLockedFriday
                                      ? 'bg-blue-50 border-blue-500 text-blue-700 cursor-not-allowed'
                                      : 'bg-blue-50 border-blue-500 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                {day.substring(0, 3)}
                              </button>
                            );
                          })}
                        </div>

                        {fridayDoublePack && (
                          <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-medium text-amber-700 flex items-start gap-2">
                            <span className="shrink-0">📦</span>
                            <span>
                              <strong>Friday Double Delivery:</strong> 2 tiffins will be packed and
                              delivered on Friday to cover Saturday.
                            </span>
                          </div>
                        )}

                        <div className="mt-2 text-[11px] text-gray-400 font-medium">
                          {formatSchedule(selectedDays) || (
                            <span className="text-amber-500 font-semibold">No Deliveries Scheduled</span>
                          )}
                        </div>
                      </div>

                      {/* ROW 5: Special Instructions */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Special Instructions</label>
                        <textarea
                          rows={2}
                          value={specialInstructions}
                          onChange={(e) => setSpecialInstructions(e.target.value)}
                          placeholder="e.g. Less spicy, No onions, Extra napkins..."
                          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none resize-none focus:border-blue-500 text-gray-700 font-sans leading-relaxed"
                        />
                      </div>

                      {/* DISCOUNT */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Discount</label>
                        <div className="flex gap-2">
                          {([
                            { key: 'none', label: 'No Discount' },
                            { key: 'flat', label: '$ Flat' },
                            { key: 'percent', label: '% Off' },
                          ] as const).map(opt => (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => setDiscountType(opt.key)}
                              className={`flex-1 h-9 px-3 rounded-lg text-xs font-semibold border transition-all ${
                                discountType === opt.key
                                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        {discountType !== 'none' && (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                {discountType === 'flat' ? 'Discount Amount ($)' : 'Discount Percentage (%)'}
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={discountType === 'percent' ? '1' : '0.01'}
                                value={discountValue}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                placeholder={discountType === 'flat' ? 'e.g. 2.50' : 'e.g. 10'}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm text-gray-700"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                Promo / Reason
                              </label>
                              <input
                                type="text"
                                value={discountNote}
                                onChange={(e) => setDiscountNote(e.target.value)}
                                placeholder="e.g. First order promo, referral..."
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm text-gray-700"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* SUBSCRIPTION MANAGEMENT SECTION */}
                  {selectedCustomer && !isAddingNew && (
                    <div className="space-y-2 pt-2">
                      {/* Pause/Cancel date info banner (only shown when paused/cancelled) */}
                      {((selectedCustomer.subscription_status || 'active') === 'paused' || (selectedCustomer.subscription_status || 'active') === 'cancelled') && (
                        <div className={`px-3 py-2 rounded-lg border text-[11px] font-medium ${
                          (selectedCustomer.subscription_status || 'active') === 'cancelled'
                            ? 'bg-red-50 border-red-200 text-red-600'
                            : 'bg-amber-50 border-amber-200 text-amber-600'
                        }`}>
                          {(selectedCustomer.subscription_status || 'active') === 'paused' && selectedCustomer.pause_start_date && (
                            <span>Paused: {selectedCustomer.pause_start_date}{selectedCustomer.pause_end_date ? ` → ${selectedCustomer.pause_end_date}` : ' → Indefinite'}</span>
                          )}
                          {(selectedCustomer.subscription_status || 'active') === 'cancelled' && selectedCustomer.cancellation_reason && (
                            <span>Reason: {selectedCustomer.cancellation_reason}</span>
                          )}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        {(selectedCustomer.subscription_status || 'active') === 'active' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setPauseStartDate(new Date().toISOString().split('T')[0]);
                                setPauseEndDate('');
                                setIsIndefinitePause(false);
                                setShowPauseModal(true);
                              }}
                              className="px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[11px] font-bold hover:bg-amber-100 transition-colors"
                            >
                              ⏸️ Pause Service
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCancelReason('');
                                setCancelDate(new Date().toISOString().split('T')[0]);
                                setShowCancelModal(true);
                              }}
                              className="px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[11px] font-bold hover:bg-red-100 transition-colors"
                            >
                              🛑 Cancel Service
                            </button>
                          </>
                        )}
                        {(selectedCustomer.subscription_status || 'active') === 'paused' && (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => startTransition(async () => {
                                await resumeCustomer(selectedCustomer.id);
                                setSelectedCustomer({ ...selectedCustomer, subscription_status: 'active', pause_start_date: null, pause_end_date: null });
                                closePanelGracefully();
                              })}
                              className="px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[11px] font-bold hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {isPending ? 'Resuming...' : '▶️ Resume Service'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCancelReason('');
                                setCancelDate(new Date().toISOString().split('T')[0]);
                                setShowCancelModal(true);
                              }}
                              className="px-3 py-2.5 border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                              🛑 Cancel Service
                            </button>
                          </>
                        )}
                        {(selectedCustomer.subscription_status || 'active') === 'cancelled' && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => startTransition(async () => {
                              try {
                                await reactivateCustomer(selectedCustomer.id);
                                showToast(`${selectedCustomer.full_name} reactivated successfully`);
                                closePanelGracefully();
                              } catch (err) {
                                showToast(err instanceof Error ? err.message : 'Failed to reactivate customer', 'error');
                              }
                            })}
                            className="col-span-2 px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            {isPending ? 'Reactivating...' : '✔️ Reactivate Service'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* REMOVAL ACTION */}
                  {selectedCustomer && (
                    <button type="button" disabled={isPending} onClick={() => { if (confirm(`Delete record?`)) startTransition(async () => { await deleteCustomer(selectedCustomer.id); closePanelGracefully(); }); }} className="w-full text-center text-xs text-red-500 py-2 border border-dashed border-red-200 bg-red-50/20 rounded-lg mt-2">
                      {isPending ? 'Removing...' : 'Delete Customer Record'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        )}
      </div>

      {/* PAUSE SERVICE MODAL */}
      {showPauseModal && (confirmCustomer ?? selectedCustomer) && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => { setShowPauseModal(false); setConfirmCustomer(null); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[400px] pointer-events-auto p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-[15px] font-bold text-[#11142D] mb-1">⏸️ Pause Service</h3>
              <p className="text-[12px] text-gray-500 mb-5">
                Pausing delivery for <strong>{(confirmCustomer ?? selectedCustomer)?.full_name}</strong>
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">Pause Start Date</label>
                  <input
                    type="date"
                    value={pauseStartDate}
                    onChange={(e) => setPauseStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase">Pause End Date</label>
                    <label className="flex items-center space-x-1.5 text-[11px] text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isIndefinitePause}
                        onChange={(e) => setIsIndefinitePause(e.target.checked)}
                        className="rounded border-gray-300 text-[#5D5FEF] focus:ring-[#5D5FEF]"
                      />
                      <span>Indefinite</span>
                    </label>
                  </div>
                  <input
                    type="date"
                    value={pauseEndDate}
                    onChange={(e) => setPauseEndDate(e.target.value)}
                    disabled={isIndefinitePause}
                    className={`w-full px-3 py-2 border rounded-lg outline-none text-[13px] transition-all ${
                      isIndefinitePause
                        ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'border-[#E0E0E0] focus:border-[#5D5FEF]'
                    }`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowPauseModal(false); setConfirmCustomer(null); }}
                  className="px-4 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending || !pauseStartDate}
                  onClick={() => startTransition(async () => {
                    const target = (confirmCustomer ?? selectedCustomer)!;
                    await pauseCustomer(
                      target.id,
                      pauseStartDate,
                      isIndefinitePause ? null : pauseEndDate || null
                    );
                    setShowPauseModal(false);
                    setConfirmCustomer(null);
                    if (selectedCustomer?.id === target.id) {
                      setSelectedCustomer({
                        ...selectedCustomer,
                        subscription_status: 'paused',
                        pause_start_date: pauseStartDate,
                        pause_end_date: isIndefinitePause ? null : pauseEndDate || null,
                      });
                      closePanelGracefully();
                    }
                  })}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50"
                >
                  {isPending ? 'Pausing...' : 'Confirm Pause'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CANCEL SERVICE MODAL */}
      {showCancelModal && (confirmCustomer ?? selectedCustomer) && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => { setShowCancelModal(false); setConfirmCustomer(null); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[400px] pointer-events-auto p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-[15px] font-bold text-red-600 mb-1">🛑 Cancel Service</h3>
              <p className="text-[12px] text-gray-500 mb-5">
                This will permanently cancel delivery service for <strong>{(confirmCustomer ?? selectedCustomer)?.full_name}</strong>.
                This action can be undone by reactivating the customer.
              </p>

              <div>
                <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                  Cancellation Date
                </label>
                <input
                  type="date"
                  value={cancelDate}
                  onChange={(e) => setCancelDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px] text-slate-700 bg-white mb-3"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                  Cancellation Reason <span className="text-gray-400 normal-case">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer request, moving, budget, etc."
                  className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px] resize-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowCancelModal(false); setConfirmCustomer(null); }}
                  className="px-4 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                >
                  Keep Active
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(async () => {
                    const target = (confirmCustomer ?? selectedCustomer)!;
                    // Use the picked date at local midnight; fall back to "now" when empty.
                    const cancelledAt = cancelDate
                      ? new Date(`${cancelDate}T00:00:00`).toISOString()
                      : new Date().toISOString();
                    await cancelCustomer(target.id, cancelReason.trim() || null, cancelledAt);
                    setShowCancelModal(false);
                    setConfirmCustomer(null);
                    if (selectedCustomer?.id === target.id) {
                      setSelectedCustomer({
                        ...selectedCustomer,
                        subscription_status: 'cancelled',
                        cancellation_reason: cancelReason.trim() || null,
                        cancelled_at: cancelledAt,
                      });
                      closePanelGracefully();
                    }
                  })}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50"
                >
                  {isPending ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* DELETE CUSTOMER CONFIRMATION MODAL */}
      {showDeleteModal && confirmCustomer && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => { setShowDeleteModal(false); setConfirmCustomer(null); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[400px] pointer-events-auto p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-[15px] font-bold text-red-600 mb-1">🗑️ Delete Customer</h3>
              <p className="text-[12px] text-gray-500 mb-5">
                Are you sure you want to permanently delete <strong>{confirmCustomer.full_name}</strong>?
                This cannot be undone.
              </p>
              <div className="flex items-center justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setConfirmCustomer(null); }}
                  className="px-4 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                >
                  Keep Record
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    const customerId = confirmCustomer.id;
                    setShowDeleteModal(false);
                    setConfirmCustomer(null);
                    handleDeleteCustomer(customerId);
                  }}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50"
                >
                  {isPending ? 'Deleting...' : 'Delete Customer'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CANCELLATION DETAILS MODAL */}
      {showCancellationDetails && cancellationDetailsCustomer && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={closeCancellationDetails} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div
              className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[420px] pointer-events-auto p-6 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold text-[#11142D] capitalize truncate">
                    {cancellationDetailsCustomer.full_name}
                  </h3>
                  {cancellationDetailsCustomer.delivery_address ? (
                    <p className="text-[12px] text-gray-500 font-medium truncate mt-0.5 flex items-center">
                      <span className="mr-1">📍</span>
                      {cancellationDetailsCustomer.delivery_address}
                    </p>
                  ) : (
                    <p className="text-[12px] text-gray-300 italic mt-0.5">No address on file</p>
                  )}
                </div>
                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 border border-red-100 shrink-0">
                  Cancelled
                </span>
              </div>

              <div className="mt-5">
                <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                  Cancellation Date
                </label>
                <input
                  type="date"
                  value={cancelDetailDate}
                  onChange={(e) => setCancelDetailDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px] text-slate-700 bg-white"
                />
              </div>

              <div className="mt-3">
                <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                  Cancellation Reason
                </label>
                <textarea
                  rows={3}
                  value={cancelDetailReason}
                  onChange={(e) => setCancelDetailReason(e.target.value)}
                  placeholder="e.g. Moved away, budget, temporary break..."
                  className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px] text-slate-700 resize-none"
                />
              </div>

              <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleModalReactivate}
                  className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                >
                  Reactivate Customer
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeCancellationDetails}
                    className="px-3 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleSaveCancellationDetails}
                    className="px-4 py-2 bg-[#5D5FEF] text-white text-xs font-semibold rounded-lg hover:opacity-90 shadow-sm disabled:opacity-50"
                  >
                    {isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[70] px-4 py-2.5 rounded-lg text-white text-[13px] font-semibold shadow-lg flex items-center gap-2 transition-all ${
            toast.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
          role="status"
        >
          <span>{toast.kind === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

    </div>
  );
}