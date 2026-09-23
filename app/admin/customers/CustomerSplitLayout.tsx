'use client';

import React, { useState, useTransition, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Users, CreditCard, Pause, Play, Trash2, AlertTriangle, Handshake, FolderOpen, UtensilsCrossed, Wheat, Calendar, ShoppingBag, ClipboardList, Ban, Circle, User, X, Check, Undo2, History, Clock } from 'lucide-react';
import { createCustomer, updateCustomer, deleteCustomer, pauseCustomer, cancelCustomer, resumeCustomer, reactivateCustomer, updateCancellationDetails, searchAddress, renewCustomerCycle, upgradeCustomerPlan, clearScheduledCancellation, getCustomerActivityLogs, addManualCustomerLog, type CustomerActivityLog } from '@/app/admin/actions';
import {
  isLegacyPickupCustomer,
  normalizePickupDays,
  parseActiveScheduleDays,
  pickupDaysForCustomer,
} from '@/app/utils/customerPickup';

// Stable no-op subscription for the mount flag below.
const noopSubscribe = () => () => { };

// Plan tier options + included credits.
const PLAN_OPTIONS: { key: 'trial' | 'weekly' | 'monthly'; label: string; credits: number }[] = [
  { key: 'trial', label: 'Trial', credits: 1 },
  { key: 'weekly', label: 'Weekly', credits: 5 },
  { key: 'monthly', label: 'Monthly', credits: 20 },
];

// Delivery-day options for the schedule grid: `short` is the visible button label and
// `full` is the canonical day token used by selectedDays / toggleScheduleDay / serialization.
const SCHEDULE_DAYS = [
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
];

// First-class referral channels offered as instant-tap pills directly under the Profile
// tab's "Referred By" label. Each pill writes `referred_by` in one tap.
const REFERRAL_QUICK_PILLS = ['Instagram', 'WhatsApp', 'Flyer', 'Word of mouth'];

// Local YYYY-MM-DD key (avoids the UTC rollover of toISOString() so "today" always matches
// the user's own calendar day). Used by the Last-Service-Date scheduling comparisons.
const toLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isWeekdayDelivery = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

export type TargetLastDayResult = {
  dateKey: string;
  holidayDaysSkipped: number;
  customerDaysSkipped: number;
};

const calculateTargetLastDay = (
  startDateStr: string | null | undefined,
  totalMeals: number | null | undefined,
  closureDates?: Set<string> | Map<string, string> | string[],
  customerSkips?: Set<string>,
): TargetLastDayResult | null => {
  if (!startDateStr || !totalMeals || totalMeals <= 0) return null;

  let normalized = startDateStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    const [m, d, y] = normalized.split('/');
    normalized = `${y}-${m}-${d}`;
  }

  const date = new Date(`${normalized}T00:00:00`);
  if (isNaN(date.getTime())) return null;

  const isClosed = (d: Date): boolean => {
    if (!closureDates) return false;
    const key = toLocalDateKey(d);
    if (closureDates instanceof Set) return closureDates.has(key);
    if (closureDates instanceof Map) return closureDates.has(key);
    return closureDates.includes(key);
  };

  const isCustomerSkip = (d: Date): boolean => {
    if (!customerSkips) return false;
    return customerSkips.has(toLocalDateKey(d));
  };

  let mealsCounted = 0;
  let holidayDaysSkipped = 0;
  let customerDaysSkipped = 0;

  if (isWeekdayDelivery(date)) {
    if (isClosed(date)) {
      holidayDaysSkipped++;
    } else if (isCustomerSkip(date)) {
      customerDaysSkipped++;
    } else {
      mealsCounted = 1;
    }
  }

  while (mealsCounted < totalMeals) {
    date.setDate(date.getDate() + 1);
    if (isWeekdayDelivery(date)) {
      if (isClosed(date)) {
        holidayDaysSkipped++;
      } else if (isCustomerSkip(date)) {
        customerDaysSkipped++;
      } else {
        mealsCounted++;
      }
    }
    if (mealsCounted > 730) return null;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    dateKey: `${y}-${m}-${d}`,
    holidayDaysSkipped,
    customerDaysSkipped,
  };
};

const calculateElapsedDeliveryDays = (
  startDateStr: string | null | undefined,
  closureDates?: Set<string> | Map<string, string> | string[],
  maxCredits?: number,
  customerSkips?: Set<string>,
): number => {
  if (!startDateStr) return 0;

  let normalized = startDateStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    const [m, d, y] = normalized.split('/');
    normalized = `${y}-${m}-${d}`;
  }

  const startDate = new Date(`${normalized}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (isNaN(startDate.getTime()) || startDate > today) return 0;

  const isClosed = (d: Date): boolean => {
    if (!closureDates) return false;
    const key = toLocalDateKey(d);
    if (closureDates instanceof Set) return closureDates.has(key);
    if (closureDates instanceof Map) return closureDates.has(key);
    return closureDates.includes(key);
  };

  const isCustomerSkip = (d: Date): boolean => {
    if (!customerSkips) return false;
    return customerSkips.has(toLocalDateKey(d));
  };

  let count = 0;
  const cursor = new Date(startDate);

  while (cursor <= today) {
    if (isWeekdayDelivery(cursor) && !isClosed(cursor) && !isCustomerSkip(cursor)) {
      count++;
      if (maxCredits && count >= maxCredits) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
};

// "Fri, Sep 11" style label for the scheduled-end (amber) badges.
const formatShortLastDay = (dateKey: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// "Sep 11" style label (no weekday) for the compact ⏳ Ends status badge.
const formatShortDate = (dateKey: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

type Customer = {
  id: string;
  full_name: string;
  phone_number: string | null;
  // Optional: referred_by (free-text referral source) landed in migration 00012 and may be
  // absent on rows fetched before the schema upgrade (optional keeps the type honest).
  referred_by?: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  delivery_instructions: string | null;
  meal_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  delivery_schedule?: string | null;
  // Optional: per-day pickup flags (full day names) + legacy all-days pickup boolean.
  // Both landed in migration 00011 and may be absent on older schemas.
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  subscription_status?: string | null;
  plan_tier?: 'trial' | 'weekly' | 'monthly' | null;
  total_tiffin_credits?: number | null;
  used_credits?: number | null;
  skipped_days_count?: number | null;
  payment_status?: 'paid' | 'due' | 'overdue' | null;
  start_date?: string | null;
  cycle_end_date?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  // Optional: scheduled (future) cancel/pause support (migration 00014). The customer stays
  // active until scheduled_cancel_date (their "Last Service Date") has passed.
  scheduled_cancel_date?: string | null;
  scheduled_status?: 'cancelled' | 'paused' | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  created_at: string;
};

// Fulfillment classification for the Customer-table name cell:
//   pure_pickup   → 100% of active days are pickup  → single 🛍️ Kitchen Pickup badge
//   pure_delivery → no pickup days at all           → destination address + map link
//   hybrid        → mix of delivery + pickup days   → destination address + a compact
//                                                    🛍️ Pickup: … pill underneath
// Classification is driven by the per-day pickup_days list vs. the active
// delivery_schedule — NOT the legacy `is_pickup` convenience flag. Modern saves set
// is_pickup = true whenever ANY day is pickup, so a hybrid customer (e.g. pickup
// Tue/Wed/Thu + delivery Mon/Fri) must still keep their address visible.
type CustomerFulfillment =
  | { mode: 'pure_pickup'; pickupDays: string[] }
  | { mode: 'pure_delivery'; pickupDays: string[] }
  | { mode: 'hybrid'; pickupDays: string[] };

const getCustomerFulfillment = (customer: Customer): CustomerFulfillment => {
  const activeDays = parseActiveScheduleDays(customer.delivery_schedule);
  const pickupDays = pickupDaysForCustomer(customer);
  const pickupSet = new Set(pickupDays);
  // Pickup only counts on days the customer is actually scheduled; the order follows the
  // schedule so the pill reads left → right exactly like the Schedule column.
  const scheduledPickupDays = activeDays.filter(day => pickupSet.has(day));

  if (activeDays.length > 0) {
    if (scheduledPickupDays.length === activeDays.length) {
      return { mode: 'pure_pickup', pickupDays: scheduledPickupDays };
    }
    if (scheduledPickupDays.length > 0) {
      return { mode: 'hybrid', pickupDays: scheduledPickupDays };
    }
    return { mode: 'pure_delivery', pickupDays: [] };
  }

  // No parseable active schedule — fall back to the legacy all-days pickup signals so
  // records created under the old Kitchen Pickup flow (is_pickup flag and/or a PICKUP
  // marker in the address or name, no stored pickup_days) keep rendering the badge
  // instead of an address. A real typed destination wins over the flag.
  const addressText = (customer.delivery_address || '').trim();
  const markerText = `${addressText} ${customer.full_name ?? ''}`.toUpperCase();
  const hasRealDeliveryAddress =
    addressText !== '' && !markerText.includes('PICKUP');
  if (isLegacyPickupCustomer(customer) && !hasRealDeliveryAddress) {
    return { mode: 'pure_pickup', pickupDays: [] };
  }
  return { mode: 'pure_delivery', pickupDays: [] };
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

// Standard Roti baselines per portion tier: LG → 8 · RG → 6 · Half LG → 5 · Half RG → 4.
// Used to auto-fill a brand-new customer's Roti count (until the stepper is manually
// touched) and to power the "[Set to standard]" hint below the Roti counter in the
// meal-config drawer.
const PORTION_ROTI_DEFAULTS: Record<string, number> = {
  [PORTION_LG]: 8,
  [PORTION_RG]: 6,
  [PORTION_HALF_LG]: 5,
  [PORTION_HALF_RG]: 4,
};

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
const formatSideSummary = (counts: SideCounts, planDefaults?: SideCounts): string => {
  const parts: string[] = [];
  if (counts.dal > 0) parts.push(`${counts.dal} Dal`);
  if (counts.sabji > 0) parts.push(`${counts.sabji} Sabji`);
  if (counts.gravy > 0) parts.push(`${counts.gravy} Gravy`);
  if (counts.chicken > 0) parts.push(`${counts.chicken} Chicken`);
  let summary = parts.join(' + ');
  if (counts.salad > 0 && (!planDefaults || counts.salad > planDefaults.salad)) summary += ` + ${formatSideAddon(counts.salad, 'Salad')}`;
  if (counts.dessert > 0 && (!planDefaults || counts.dessert > planDefaults.dessert)) summary += ` + ${formatSideAddon(counts.dessert, 'Dessert')}`;
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

  return noteParts.join(' + ');
};

// The built-in "standard" curry profile for a meal type + portion.
const defaultSideCounts = (mealType: string, portion: string, planType: 'trial' | 'weekly' | 'monthly' | null): SideCounts => {
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
      salad: (p === PORTION_LG || planType === 'monthly') ? 1 : 0,
      dessert: (p === PORTION_LG || planType === 'monthly') ? 1 : 0,
    };
  }
  return {
    dal: 1,
    sabji: 1,
    gravy: 0,
    chicken: 0,
    salad: (p === PORTION_LG || planType === 'monthly') ? 1 : 0,
    dessert: (p === PORTION_LG || planType === 'monthly') ? 1 : 0,
  };
};

const curryFieldsEqual = (a: SideCounts, b: SideCounts): boolean =>
  a.dal === b.dal &&
  a.sabji === b.sabji &&
  a.gravy === b.gravy &&
  a.chicken === b.chicken;

// Curry-only deviation check: Salad / Dessert counts NEVER affect curry preset detection.
const deviatesCurryFromDefault = (mealType: string, portion: string, planType: 'trial' | 'weekly' | 'monthly' | null, counts: SideCounts): boolean =>
  !curryFieldsEqual(counts, defaultSideCounts(mealType, portion, planType));

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
  const router = useRouter();

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
  // Kitchen Dispatch / Packing Order is the landing sort for the kitchen staff, so it
  // starts ON (active button + kitchen-sequenced table) and can still be toggled off.
  const [kitchenMode, setKitchenMode] = useState(true);
  const [isPanelRendered, setIsPanelRendered] = useState(false);
  const [isSlideInActive, setIsSlideInActive] = useState(false);
  const [isAccordionExpanded, setIsAccordionExpanded] = useState(false);
  const [isEditingParams, setIsEditingParams] = useState(false);

  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const addressContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);// Restore the missing aiLoading state
  const [aiLoading, setAiLoading] = useState(false);

  // Kitchen Closures Set & Customer Skips Map
  const [closuresSet, setClosuresSet] = useState<Set<string>>(new Set());
  const [skipsMap, setSkipsMap] = useState<Map<string, Set<string>>>(new Map());
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchClosuresAndSkips = async () => {
    try {
      const { createClient } = await import('@/utils/supabase/client');
      const supabase = createClient();

      const [closuresRes, skipsRes] = await Promise.all([
        supabase.from('kitchen_closures').select('closure_date'),
        supabase
          .from('customer_daily_overrides')
          .select('customer_id, override_date')
          .eq('is_skipped', true),
      ]);

      if (closuresRes.data) {
        setClosuresSet(new Set(closuresRes.data.map((c: any) => c.closure_date)));
      }

      if (skipsRes.data) {
        const map = new Map<string, Set<string>>();
        skipsRes.data.forEach((row: any) => {
          const cId = String(row.customer_id);
          const sDate = String(row.override_date || '').slice(0, 10);
          if (cId && sDate) {
            if (!map.has(cId)) map.set(cId, new Set());
            map.get(cId)!.add(sDate);
          }
        });
        setSkipsMap(map);
      }
    } catch (err) {
      console.error('[Customers] Failed to fetch closures or skips:', err);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await fetchClosuresAndSkips();
      router.refresh();
      showToast('Customer data, skips & closures synced');
    } catch (err) {
      showToast('Failed to sync', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (isMounted) await fetchClosuresAndSkips();
      } catch (err) {
        console.error('[Customers] Failed to fetch closures or skips:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Toast notification state (e.g. success after reactivating a cancelled customer)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Post-save feedback: id of the row just created/edited → drives the pulse highlight
  // + auto-scroll, then is cleared 3s after the save completes.
  const [lastModifiedCustomerId, setLastModifiedCustomerId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Locally prepended rows created during this session (shown above the server rows at
  // index 0 until a server refresh adopts them into initialCustomers).
  const [newlyAddedCustomers, setNewlyAddedCustomers] = useState<Customer[]>([]);
  // Rows patched right after an update save so the list/drawer reflect the change even
  // before router.refresh() re-renders with the fresh server rows. Each patch remembers
  // the JSON signature of the stale server row it replaced: customersForDisplay only lets
  // the patch win while the server row is still unchanged (pre-refresh), and automatically
  // falls back to the authoritative server row once a refresh adopts the save.
  const [rowPatches, setRowPatches] = useState<Record<string, { updated: Customer; staleSignature: string }>>({});

  // Calendar "today" in the user's local timezone (used by scheduled-end date logic).
  const todayKey = toLocalDateKey(new Date());

  // Subscription management state
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'cancelled'>('active');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  // Confirmation-modal target: lets the row dropdown reuse the drawer's dialogs
  // without forcing the edit drawer to open (null → drawer's selectedCustomer).
  const [confirmCustomer, setConfirmCustomer] = useState<Customer | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
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
  const [referredBy, setReferredBy] = useState('');
  // Referral typeahead suggestion pool: every existing customer full name so the
  // "Referred By" combobox can autocomplete a referring customer. When editing an
  // existing customer the record itself is excluded (no self-referral suggestions).
  const referralSuggestions = useMemo(() => {
    const selfId = !isAddingNew ? selectedCustomer?.id ?? null : null;
    const names = Array.from(
      new Set(
        initialCustomers
          .filter(c => c.id !== selfId)
          .map(c => c.full_name.trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    return names;
  }, [initialCustomers, isAddingNew, selectedCustomer?.id]);
  // The typeahead menu stays CLOSED by default — a dropdown of matching customer names
  // renders only once 2+ characters are typed and is capped at 5 rows so it never feels
  // oversized. Free-form text is still allowed: whatever is typed (or left in the input)
  // is saved as `referred_by` when no suggestion is clicked.
  const visibleReferralSuggestions = useMemo(() => {
    const q = referredBy.trim().toLowerCase();
    if (q.length < 2) return [];
    return referralSuggestions
      .filter(name => name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [referredBy, referralSuggestions]);
  // Explicit open flag (not derived from text length alone) so tapping a pill or picking
  // a suggestion never re-opens the menu for the now-matching text.
  const [isReferralMenuOpen, setIsReferralMenuOpen] = useState(false);
  const referralContainerRef = useRef<HTMLDivElement>(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [rawNotes, setRawNotes] = useState('');
  const [mealType, setMealType] = useState('');
  const [portionSize, setPortionSize] = useState('');
  const [planTier, setPlanTier] = useState<'trial' | 'weekly' | 'monthly'>('monthly');
  const [totalTiffinCredits, setTotalTiffinCredits] = useState<number>(20);
  const [startDate, setStartDate] = useState('');
  const [rotiCount, setRotiCount] = useState<number | ''>('');
  const [pronthiCount, setPronthiCount] = useState<number | ''>('');
  const [usedCredits, setUsedCredits] = useState<number>(0);
  // Bread-count ownership guard: while FALSE on a brand-new customer, toggling the Portion
  // Size keeps Roti synced to the selected tier's standard default. Any manual stepper /
  // input change (or restoring a stored count) flips it TRUE, after which Portion Size and
  // Meal Type toggles never silently overwrite the Roti count again.
  const [isRotiCountCustom, setIsRotiCountCustom] = useState(false);
  const [riceCount, setRiceCount] = useState('');
  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [selectedDays, setSelectedDays] = useState<string[]>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

  // Drawer (Add/Edit) 4-tab navigation state + smart-validation errors.
  const [activeDrawerTab, setActiveDrawerTab] = useState<'profile' | 'plan' | 'meal' | 'history'>('profile');
  const [activityLogs, setActivityLogs] = useState<CustomerActivityLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Manual Activity Log Entry State
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLogSummary, setNewLogSummary] = useState('');
  const [newLogDate, setNewLogDate] = useState(() => toLocalDateKey(new Date()));
  const [newLogType, setNewLogType] = useState<'NOTE' | 'BILLING' | 'OVERRIDE'>('NOTE');
  const [isSavingLog, setIsSavingLog] = useState(false);

  const handleCreateManualLog = async () => {
    if (!selectedCustomer?.id || !newLogSummary.trim()) return;
    setIsSavingLog(true);
    try {
      const res = await addManualCustomerLog({
        customerId: selectedCustomer.id,
        summary: newLogSummary,
        actionType: newLogType,
        date: newLogDate,
      });
      if (res.success && res.log) {
        setActivityLogs(prev => [res.log, ...prev]);
        setNewLogSummary('');
        setIsAddingLog(false);
        showToast('Activity log added');
      } else {
        showToast(res.message || 'Failed to add log', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add log', 'error');
    } finally {
      setIsSavingLog(false);
    }
  };

  // Fetch activity logs whenever a persisted customer is opened
  useEffect(() => {
    if (!selectedCustomer?.id || isAddingNew) {
      setActivityLogs([]);
      return;
    }
    setIsLoadingLogs(true);
    getCustomerActivityLogs(selectedCustomer.id)
      .then(logs => setActivityLogs(logs))
      .catch(err => console.error('[Audit] Failed to load activity logs:', err))
      .finally(() => setIsLoadingLogs(false));
  }, [selectedCustomer?.id, isAddingNew]);
  // Per-day pickup mode: which active schedule days are marked '🛍️ Pickup' instead of
  // '🚗 Delivery'. Persisted to the customers.pickup_days column (full day names).
  const [pickupDays, setPickupDays] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<{ fullName?: string; deliveryAddress?: string }>({});
  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const deliveryAddressInputRef = useRef<HTMLInputElement>(null);
  // Set when "Duplicate Customer" opens the drawer so Full Name gets focused/selected
  // immediately for a quick name tweak before saving.
  const [focusFullNameOnDuplicate, setFocusFullNameOnDuplicate] = useState(false);

  // The Profile-tab "Kitchen Pickup" switch is a global convenience derived from the
  // per-day pills in the Delivery Schedule block below the address: ON ⇔ every active
  // day is pickup, so toggling individual pills flips the switch automatically.
  const allDaysArePickup =
    selectedDays.length > 0 && selectedDays.every(d => pickupDays.includes(d));
  // Address is only mandatory when at least one active day is a real Delivery day.
  const hasDeliveryDay = selectedDays.some(d => !pickupDays.includes(d));
  const pickupDayCount = selectedDays.filter(d => pickupDays.includes(d)).length;

  // Subtitle under the master Kitchen Pickup switch — keeps mixed schedules obvious so a
  // Delivery-only day makes it clear a destination address is required.
  const pickupModeSubtitle =
    selectedDays.length === 0
      ? 'No active days selected yet.'
      : allDaysArePickup
        ? 'Every active day is Pickup — delivery address optional.'
        : pickupDayCount > 0
          ? 'Mixed schedule: Deliveries require destination address.'
          : 'All active days are Delivery — destination address required.';

  // Roster rendered in the table = locally created rows (prepended at index 0) + server
  // rows. Rows already adopted by a server refresh are dropped from the local prefix so
  // the table never shows the same record twice (the row id stays identical either way).
  const customersForDisplay = useMemo(() => {
    const serverIds = new Set(initialCustomers.map(c => c.id));
    const localPrefix = newlyAddedCustomers.filter(c => !serverIds.has(c.id));
    const patchedServerRows =
      Object.keys(rowPatches).length > 0
        ? initialCustomers.map(c => {
          const patch = rowPatches[c.id];
          if (!patch) return c;
          // The patch only applies until the server copy differs from the stale row it
          // replaced (i.e. until router.refresh() delivers the adopted record).
          return patch.staleSignature !== JSON.stringify(c) ? c : patch.updated;
        })
        : initialCustomers;
    return [...localPrefix, ...patchedServerRows];
  }, [newlyAddedCustomers, initialCustomers, rowPatches]);

  // Post-save feedback: gently bring the just-saved row into view so its pulse is seen.
  useEffect(() => {
    if (!lastModifiedCustomerId) return;
    const scrollTimer = setTimeout(() => {
      document
        .getElementById(`customer-row-${lastModifiedCustomerId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 250); // brief delay: lets the drawer close + the fresh row mount first
    return () => clearTimeout(scrollTimer);
  }, [lastModifiedCustomerId]);

  // Clear a pending 3s pulse timer if the component unmounts before it fires.
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    []
  );

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

    let nextDays: string[];
    if (day === 'Saturday') {
      if (selectedDays.includes('Saturday')) {
        nextDays = selectedDays.filter(d => d !== 'Saturday');
      } else {
        // Selecting Saturday forces Friday on so the double pack can be delivered.
        nextDays = [...new Set([...selectedDays, 'Friday', 'Saturday'])];
      }
    } else {
      nextDays = selectedDays.includes(day)
        ? selectedDays.filter(d => d !== day)
        : [...selectedDays, day];
    }

    setSelectedDays(nextDays);
    // A deactivated day can no longer carry a pickup flag.
    setPickupDays(prev => prev.filter(p => nextDays.includes(p)));
  };

  // Toggles one active schedule day between Delivery (default) and Pickup.
  const togglePickupDay = (day: string) => {
    const wasPickup = pickupDays.includes(day);
    setPickupDays(prev =>
      wasPickup ? prev.filter(d => d !== day) : [...prev, day]
    );
    // A day flipped to Delivery means the customer now needs a real drop-off address;
    // drop the legacy placeholder marker so validation forces a real address.
    if (
      wasPickup &&
      deliveryAddress.trim().toUpperCase() === 'KITCHEN PICKUP'
    ) {
      setDeliveryAddress('');
    }
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

  // Curry container occupancy only — Salad / Dessert are sides and must never
  // inflate the "(n/2 containers/day)" limit or disable curry + buttons.
  const totalCurryCount = dalCount + sabjiCount + gravyCount + chickenCount;
  const curryContainerLimit = isHalfPortion(portionSize) ? 1 : 2;

  const getDefaultRotiCount = (portion: string): number =>
    PORTION_ROTI_DEFAULTS[normalizePortionToken(portion)] ?? PORTION_ROTI_DEFAULTS[PORTION_RG];

  const isStandardNonVegProfile = (dal: number, sabji: number, gravy: number, chicken: number): boolean =>
    dal === 0 && sabji === 1 && gravy === 0 && chicken === 1;

  // ═══════════════════════════════════════════════════════════════
  // Applies the automatic curry (side-dish) defaults when Meal Type or Portion Size
  // toggles. Bread counts (Roti / Pronthi) are deliberately NOT touched here — bread
  // re-baselining happens only in the create flow and only until the operator manually
  // adjusts the count (see handlePortionChange / handleSetRotiToStandard).
  //   Veg (RG/LG) → 1 Dal + 1 Sabji
  //   Non-Veg (RG/LG) → 1 Sabji + Chicken Mon/Wed/Fri + veg Tue/Thu
  //   Half (RG/LG) → single container/day
  // ═══════════════════════════════════════════════════════════════
  const applyMealDefaults = (type: string, portion: string) => {
    const isNonVeg = type === 'Non-veg';
    const p = normalizePortionToken(portion);

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
    // Only the meal type + its curry profile change here. Veg ⇄ Non-veg never touches the
    // Roti / Pronthi bread counts (manual customizations stay put).
    applyMealDefaults(newType, activePortion);
  };

  const handlePortionChange = (newPortion: string) => {
    const canonicalPortion = normalizePortionToken(newPortion);
    setPortionSize(canonicalPortion);
    const activeMealType = mealType || 'Veg';
    if (!mealType) setMealType('Veg');
    applyMealDefaults(activeMealType, canonicalPortion);

    // Bread safety: only auto-sync Roti for a brand-new customer that is still on the
    // automatic baseline (no manual stepper/input yet). Existing customers (edit mode)
    // and any manually-customized count keep their Roti value when the portion changes.
    if (isAddingNew && !isRotiCountCustom) {
      setRotiCount(getDefaultRotiCount(canonicalPortion));
    }
  };

  // Explicitly snaps the Roti count back to the selected tier's standard baseline. Wired
  // only to the "[Set to standard]" hint — Portion Size toggles themselves never call it.
  const handleSetRotiToStandard = () => {
    setRotiCount(getDefaultRotiCount(portionSize || PORTION_RG));
  };

  // True while the drawer is editing a persisted customer (has an id), as opposed to
  // creating a new one — used to decide when Roti auto-baselining is permitted.
  const editingExistingCustomer = !isAddingNew && !!selectedCustomer?.id;
  const selectedPortionForRoti = normalizePortionToken(portionSize || PORTION_RG);
  const defaultRotiForPortion = getDefaultRotiCount(selectedPortionForRoti);
  // Subtle "Standard for X is Y rotis. [Set to standard]" hint under the Roti counter.
  // Shown when the operator owns the bread count (editing an existing customer, or a
  // manual customization during create) and the current value has drifted from the
  // selected tier's standard baseline.
  const showRotiStandardHint =
    (editingExistingCustomer || isRotiCountCustom) &&
    rotiCount !== '' &&
    Number(rotiCount) !== defaultRotiForPortion;

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
      setIsReferralMenuOpen(false);
      // Every drawer open starts on the Profile tab with a clean validation slate.
      setActiveDrawerTab('profile');
      setFormErrors({});
      const timer = setTimeout(() => setIsSlideInActive(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsSlideInActive(false);
      const timer = setTimeout(() => setIsPanelRendered(false), 200);
      return () => clearTimeout(timer);
    }
  }, [selectedCustomer, isAddingNew]);

  // "Duplicate Customer" opens the drawer in create mode pre-filled from the source row;
  // once the Profile tab mounts, select the Full Name field so it can be tweaked right
  // away (e.g. append " (copy)") before the operator clicks Save Customer.
  useEffect(() => {
    if (!focusFullNameOnDuplicate || !isAddingNew) return;
    const timer = setTimeout(() => {
      setFocusFullNameOnDuplicate(false);
      fullNameInputRef.current?.focus();
      fullNameInputRef.current?.select();
    }, 100);
    return () => clearTimeout(timer);
  }, [focusFullNameOnDuplicate, isAddingNew]);
  // Synchronize tier with credits when nudged via + / -
  const handleUpdateCredits = (nextCredits: number) => {
    const validCredits = Math.max(1, nextCredits);
    setTotalTiffinCredits(validCredits);
    if (validCredits >= 20) {
      setPlanTier('monthly');
    } else if (validCredits >= 5) {
      setPlanTier('weekly');
    } else {
      setPlanTier('trial');
    }
  };

  const currentCustomerSkips = useMemo(() => {
    return selectedCustomer ? skipsMap.get(selectedCustomer.id) : undefined;
  }, [selectedCustomer, skipsMap]);

  // Live Auto-Calculated Projected End Date with breakdown
  const computedEndResult = useMemo(() => {
    return calculateTargetLastDay(startDate, totalTiffinCredits, closuresSet, currentCustomerSkips);
  }, [startDate, totalTiffinCredits, closuresSet, currentCustomerSkips]);

  const computedEndDate = computedEndResult?.dateKey || null;
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
      planTier,
      liveSideCounts
    );

  // Extra add-ons beyond the plan's default allowance are tracked separately.
  const planDefaults = defaultSideCounts(
    mealType || 'Veg',
    normalizePortionToken(portionSize || PORTION_RG),
    planTier
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
      const target = event.target as Node;
      if (addressContainerRef.current && !addressContainerRef.current.contains(target)) {
        setAddressSuggestions([]);
      }
      if (referralContainerRef.current && !referralContainerRef.current.contains(target)) {
        setIsReferralMenuOpen(false);
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
          await pauseCustomer(customer.id, toLocalDateKey(new Date()), null);
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
    const customer = customersForDisplay.find(c => c.id === customerId);
    if (customer) handleUpdateStatus(customer, nextStatus);
  };

  // Executes the destructive delete by customer id (confirmation is handled by the caller).
  const handleDeleteCustomer = (customerId: string) => {
    setActiveMenuId(null);
    const customer = customersForDisplay.find(c => c.id === customerId);
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
    // Reset per-dialog inputs. Dates default to today (pause/cancel take effect immediately).
    setPauseStartDate(toLocalDateKey(new Date()));
    setPauseEndDate('');
    setIsIndefinitePause(false);
    setCancelDate(toLocalDateKey(new Date()));
    setCancelReason('');
    if (type === 'pause') setShowPauseModal(true);
    else if (type === 'cancel') setShowCancelModal(true);
    else setShowDeleteModal(true);
  };

  const openRenewModal = (customer: Customer) => {
    setActiveMenuId(null);
    setConfirmCustomer(customer);
    setShowRenewModal(true);
  };

  const openUpgradeModal = (customer: Customer) => {
    setActiveMenuId(null);
    setConfirmCustomer(customer);
    setShowUpgradeModal(true);
  };

  const confirmRenewCycle = () => {
    if (!confirmCustomer) return;
    startTransition(async () => {
      try {
        await renewCustomerCycle(confirmCustomer.id);
        setShowRenewModal(false);
        setConfirmCustomer(null);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to renew cycle', 'error');
      }
    });
  };

  const confirmUpgradePlan = (newTier: 'weekly' | 'monthly') => {
    if (!confirmCustomer) return;
    startTransition(async () => {
      try {
        await upgradeCustomerPlan(confirmCustomer.id, newTier);
        setShowUpgradeModal(false);
        setConfirmCustomer(null);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to upgrade plan', 'error');
      }
    });
  };

  const confirmUpgradeToWeekly = () => confirmUpgradePlan('weekly');
  const confirmUpgradeToMonthly = () => confirmUpgradePlan('monthly');

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



  const filteredCustomers = customersForDisplay.filter(c => {
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

  // Column subtotals and summary metrics computed from the active filtered view
  let totalRotis = 0;
  let totalPronthis = 0;
  let riceRgCount = 0;
  let riceLgCount = 0;
  let riceXlCount = 0;

  // Granular size counts split by Veg vs Non-Veg
  const vegSizes = { lg: 0, rg: 0, hlg: 0, hrg: 0 };
  const nvSizes = { lg: 0, rg: 0, hlg: 0, hrg: 0 };

  for (const c of sortedCustomers) {
    const isNv = (c.meal_type || '').toLowerCase().includes('non');
    const target = isNv ? nvSizes : vegSizes;
    const p = normalizePortionToken(c.portion_size);

    if (p === PORTION_LG) target.lg++;
    else if (p === PORTION_HALF_LG) target.hlg++;
    else if (p === PORTION_HALF_RG) target.hrg++;
    else target.rg++;

    if (typeof c.roti_count === "number" && c.roti_count > 0) totalRotis += c.roti_count;
    if (typeof c.pronthi_count === "number" && c.pronthi_count > 0) totalPronthis += c.pronthi_count;
    const rawRice = (c.rice_count || "").toLowerCase();
    if (rawRice === "" || rawRice === "none" || rawRice === "—") continue;
    for (const token of rawRice.split("+")) {
      const m = token.trim().match(/^(\d+)\s*(rg|lg|xl)$/);
      if (!m) continue;
      const qty = parseInt(m[1], 10);
      if (m[2] === "rg") riceRgCount += qty;
      else if (m[2] === "lg") riceLgCount += qty;
      else if (m[2] === "xl") riceXlCount += qty;
    }
  }

  const formatSizeTokens = (s: { lg: number; rg: number; hlg: number; hrg: number }) => {
    const tokens: string[] = [];
    if (s.lg > 0) tokens.push(`${s.lg} LG`);
    if (s.rg > 0) tokens.push(`${s.rg} RG`);
    if (s.hlg > 0) tokens.push(`${s.hlg} Half-LG`);
    if (s.hrg > 0) tokens.push(`${s.hrg} Half-RG`);
    return tokens.length > 0 ? tokens.join(' · ') : '0';
  };

  const totalVeg = vegSizes.lg + vegSizes.rg + vegSizes.hlg + vegSizes.hrg;
  const totalNv = nvSizes.lg + nvSizes.rg + nvSizes.hlg + nvSizes.hrg;

  const riceTotalParts: string[] = [];
  if (riceRgCount > 0) riceTotalParts.push(`${riceRgCount} Rg`);
  if (riceLgCount > 0) riceTotalParts.push(`${riceLgCount} Lg`);
  if (riceXlCount > 0) riceTotalParts.push(`${riceXlCount} Xl`);
  const riceHeaderTotal = riceTotalParts.join(" + ");

  const breadTotalParts: string[] = [];
  if (totalRotis > 0) breadTotalParts.push(`${totalRotis} Roti`);
  if (totalPronthis > 0) breadTotalParts.push(`${totalPronthis} Pronthi`);
  const breadHeaderTotal = breadTotalParts.join(" + ");

  const handleOpenAddForm = () => {
    setFullName('');
    setPhoneNumber('');
    setContactChannel('phone');
    setReferredBy('');
    setDeliveryAddress('');
    setRawNotes('');
    // Default meal settings for every new customer (Meal Config tab):
    // meal_type 'Veg' · portion_size 'RG' · roti_count 6 · pronthi_count 0
    setMealType('Veg');
    setPortionSize(PORTION_RG);
    setPlanTier('monthly');
    setTotalTiffinCredits(20);
    setStartDate('');
    setUsedCredits(0);
    // RG baseline = 6 Roti (tier map: LG 8 · RG 6 · Half LG 5 · Half RG 4). MUST be the RG
    // standard, not LG — Portion Size toggles re-sync until the stepper is manually touched.
    setRotiCount(getDefaultRotiCount(PORTION_RG));
    setPronthiCount(0);
    // Brand-new customers open on the automatic Roti-baseline path: toggling Portion Size
    // keeps Roti matched to the tier default until the operator adjusts it manually.
    setIsRotiCountCustom(false);
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
    setPickupDays([]);
    setSideNotes('');
    setSpecialInstructions('');
    setDiscountType('none');
    setDiscountValue('');
    setDiscountNote('');
    setCancelReason('');
    setCancelDate('');

    // Fill the standard Veg curry profile (1 Dal + 1 Sabji) for the RG default. Bread
    // counts are already at the RG standard above — applyMealDefaults no longer touches
    // Roti / Pronthi (bread re-baselining is handled by the portion-toggle logic).
    applyMealDefaults('Veg', PORTION_RG);
    // Open the drawer on the Profile tab with pickup off and a clean error state.
    setActiveDrawerTab('profile');
    setFormErrors({});

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

  // Populates every drawer field from an existing customer row. Shared by the row's
  // Edit action and the "Duplicate Customer" create-mode prefill.
  const applyCustomerToForm = (customer: Customer) => {
    setFullName(customer.full_name || '');
    const parsedContact = parseStoredContact(customer.phone_number);
    setPhoneNumber(parsedContact.value);
    setContactChannel(parsedContact.channel);
    setReferredBy(customer.referred_by || '');
    setDeliveryAddress(customer.delivery_address || '');
    setFormErrors({});
    setRawNotes(customer.dietary_notes || '');
    setMealType(customer.meal_type || '');

    const restoredPortion = customer.portion_size ? normalizePortionToken(customer.portion_size) : PORTION_RG;
    setPortionSize(restoredPortion);
    applyMealDefaults(customer.meal_type || 'Veg', restoredPortion);

    // Restore subscription plan + optional start date.
    // Enforce 1-to-1 sync: if credits don't match the plan tier, the tier's standard allowance takes precedence
    const restoredTier: 'trial' | 'weekly' | 'monthly' =
      customer.plan_tier === 'trial' || customer.plan_tier === 'weekly' || customer.plan_tier === 'monthly'
        ? customer.plan_tier
        : 'monthly';
    setPlanTier(restoredTier);

    const standardCredits = PLAN_OPTIONS.find(o => o.key === restoredTier)?.credits ?? 20;

    // Respect whatever credits are saved on the customer; fall back to the plan standard only if empty or legacy 25
    if (customer.total_tiffin_credits && customer.total_tiffin_credits > 0) {
      // Only fix legacy 25-credit monthly records
      if (restoredTier === 'monthly' && customer.total_tiffin_credits === 25) {
        setTotalTiffinCredits(20);
      } else {
        setTotalTiffinCredits(customer.total_tiffin_credits);
      }
    } else {
      setTotalTiffinCredits(standardCredits);
    }
    setStartDate(customer.start_date ? customer.start_date.slice(0, 10) : '');

    // Dynamically calculate elapsed deliveries (subtracting skips and closures)
    const targetSkips = skipsMap.get(customer.id);
    const resolvedCredits =
      customer.total_tiffin_credits && customer.total_tiffin_credits > 0
        ? (restoredTier === 'monthly' && customer.total_tiffin_credits === 25 ? 20 : customer.total_tiffin_credits)
        : standardCredits;

    const autoElapsed = calculateElapsedDeliveryDays(
      customer.start_date,
      closuresSet,
      resolvedCredits,
      targetSkips
    );
    setUsedCredits(autoElapsed);

    // ⚠️ Restore DB values AFTER defaults — prevents defaults from overwriting saved data.
    // When the row has no stored bread count, fall back to the selected tier's standard
    // Roti baseline (never inherit a stale count from a previous drawer session) and clear
    // Pronthi. A stored count is operator-owned: it is flagged custom so later Portion Size
    // / Meal Type toggles never silently reset it (see handlePortionChange).
    if (customer.roti_count !== null && customer.roti_count !== undefined) {
      setRotiCount(customer.roti_count);
      setIsRotiCountCustom(true);
    } else {
      setRotiCount(getDefaultRotiCount(restoredPortion));
      setIsRotiCountCustom(false);
    }
    if (customer.pronthi_count !== null && customer.pronthi_count !== undefined) {
      setPronthiCount(customer.pronthi_count);
    } else {
      setPronthiCount(0);
    }

    const riceCounters = parseRiceIntoCounters(customer.rice_count);
    setRiceRg(riceCounters.rg);
    setRiceLg(riceCounters.lg);
    setRiceXl(riceCounters.xl);

    setRiceCount(formatRiceCellText(customer.rice_count));
    // Restore schedule under current rules (no Sunday; Saturday keeps Friday on).
    // Records without a stored schedule open on the standard Mon–Fri default.
    const restoredDays = normalizeScheduleDays(parseScheduleDays(customer.delivery_schedule));
    const scheduleDaysForEdit = restoredDays.length > 0 ? restoredDays : [...WEEKDAY_DELIVERY_DAYS];
    setSelectedDays(scheduleDaysForEdit);

    // Restore per-day pickup flags. Records created under the legacy all-days Kitchen
    // Pickup flow (is_pickup true and/or a PICKUP marker) with no pickup_days yet are
    // treated as pickup on every active schedule day (backward compatibility).
    const storedPickupDays = normalizePickupDays(customer.pickup_days).filter(d =>
      scheduleDaysForEdit.includes(d)
    );
    const effectivePickupDays =
      storedPickupDays.length > 0
        ? storedPickupDays
        : isLegacyPickupCustomer(customer)
          ? [...scheduleDaysForEdit]
          : [];
    setPickupDays(effectivePickupDays);

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

  // Opens the drawer in edit mode for a customer (row click / row Edit action).
  const handleRowClick = (customer: Customer) => {
    setIsAddingNew(false);
    setSelectedCustomer(customer);
    applyCustomerToForm(customer);
  };

  // "Duplicate Customer" (row overflow menu): opens the drawer in create (Add Customer)
  // mode pre-filled from the source row. Nothing persists to Supabase until the user
  // explicitly clicks "Save Customer" — this handler only stages the form.
  const handleDuplicateCustomer = (customer: Customer) => {
    setActiveMenuId(null);
    setSelectedCustomer(null); // never let a stale edit target hijack create mode
    applyCustomerToForm(customer);
    // Copy the plan tier but reset financials to clean create defaults: fresh credit
    // balance for the tier and no copied start date (0 delivered is guaranteed because
    // the create path never carries used_credits / delivery history over).
    const tier =
      customer.plan_tier === 'trial' || customer.plan_tier === 'weekly' || customer.plan_tier === 'monthly'
        ? customer.plan_tier
        : 'monthly';
    setTotalTiffinCredits(PLAN_OPTIONS.find(o => o.key === tier)?.credits ?? 20);
    setStartDate('');
    setFormErrors({});
    setFocusFullNameOnDuplicate(true);
    setIsAddingNew(true);
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
      Small: { roti: 4, curries: 1, premium: '' },
      Regular: { roti: 6, curries: 2, premium: '' },
      Large: { roti: 8, curries: 2, premium: ' + Salad + Dessert (weekly)' },
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
    // A bread count resolved from the notes is operator-owned — never overwrite it later.
    setIsRotiCountCustom(true);

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

    // ── Smart validation ──────────────────────────────────────────────
    // Full Name is always required. The Delivery Destination Address is only required
    // when at least one active schedule day is a real Delivery day (all-Pickup
    // schedules make it optional). If the offending field lives on an inactive tab,
    // auto-switch to that tab, focus the invalid input, and halt submission.
    const requiredErrors: { fullName?: string; deliveryAddress?: string } = {};
    if (!fullName.trim()) requiredErrors.fullName = 'Full name is required';
    if (hasDeliveryDay && !deliveryAddress.trim()) {
      requiredErrors.deliveryAddress =
        'Delivery address is required — at least one scheduled day is a Delivery day (or mark every day as Pickup)';
    }
    setFormErrors(requiredErrors);
    if (requiredErrors.fullName || requiredErrors.deliveryAddress) {
      if (activeDrawerTab !== 'profile') setActiveDrawerTab('profile');
      const focusRef = requiredErrors.fullName ? fullNameInputRef : deliveryAddressInputRef;
      // Wait for the Profile tab content to mount before focusing its input.
      setTimeout(() => focusRef.current?.focus(), 60);
      return; // halt submission — drawer stays open until valid
    }

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

    // Per-day pickup flags persist only for active schedule days. Fully-pickup records
    // with no typed address keep the legacy "Kitchen Pickup" marker so older views
    // (customers list badge, prep manifest) keep recognising the record.
    const finalPickupDays = selectedDays.filter(d => pickupDays.includes(d));
    const finalAddress =
      deliveryAddress.trim() ||
      (allDaysArePickup ? 'Kitchen Pickup' : '');

    const payload = {
      full_name: fullName.trim(),
      phone_number: formatContactValue(contactChannel, phoneNumber) || null,
      referred_by: referredBy.trim() || null,
      delivery_address: finalAddress,
      dietary_notes: specialInstructions.trim() || null,
      meal_type: mealType || 'Veg',
      portion_size: finalPortion,
      plan_tier: planTier,
      total_tiffin_credits: totalTiffinCredits,
      used_credits: usedCredits,
      start_date: startDate.trim() || null,
      cycle_end_date: computedEndDate || null,
      roti_count: rotiCount === '' ? null : Number(rotiCount),
      pronthi_count: pronthiCount === '' ? null : Number(pronthiCount),
      rice_count: builtRice,
      delivery_schedule: serializeSchedule(selectedDays) || DEFAULT_DELIVERY_SCHEDULE,
      delivery_instructions: finalInstructions,
      is_pickup: finalPickupDays.length > 0,
      pickup_days: finalPickupDays,
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

    // Log the exact payload before firing so persistence issues (e.g. missing pickup_days
    // in the DB schema or in the network request) are visible in the browser console.
    console.log('Saving customer payload:', payload);

    startTransition(async () => {
      try {
        let savedCustomerId: string | null = null;

        if (isAddingNew) {
          const created = (await createCustomer(payload)) as unknown as Customer | null;
          if (created) {
            savedCustomerId = created.id;
            // Prepends the new record at index 0 so it appears at the very top.
            setNewlyAddedCustomers(prev => [created, ...prev]);
            showToast(
              `${created.full_name || fullName.trim()} added to ${created.plan_tier || planTier || 'monthly'} plan`
            );
          }
        } else if (selectedCustomer) {
          // updateCustomer returns the refreshed Supabase row so the list can be patched
          // immediately (no waiting on the router refresh) — this is what makes per-day
          // pickup flags rehydrate correctly on a fast close → re-open of the drawer.
          const updated = (await updateCustomer(
            selectedCustomer.id,
            payload
          )) as unknown as Customer | null;
          savedCustomerId = selectedCustomer.id;
          if (updated) {
            setRowPatches(prev => ({
              ...prev,
              [updated.id]: {
                updated,
                // Snapshot of the row that was opened pre-save — used to detect when the
                // router refresh adopts this save (see customersForDisplay above).
                staleSignature: JSON.stringify(selectedCustomer),
              },
            }));
          }
          showToast(`Changes saved for ${fullName.trim()}`);
        }

        // Post-save feedback: pulse + auto-scroll the row, then clear after 3s.
        if (savedCustomerId) {
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          setLastModifiedCustomerId(savedCustomerId);
          highlightTimerRef.current = setTimeout(() => setLastModifiedCustomerId(null), 3000);
        }

        // Refetch the server rows so the table reflects the save (and any locally
        // prepended new row is adopted & de-duplicated by customersForDisplay above).
        router.refresh();

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

  const totalVegCount = customersForDisplay.filter(c => {
    const meal = (c.meal_type || '').toLowerCase();
    return meal.includes('veg') && !meal.includes('non');
  }).length;

  const totalNonVegCount = customersForDisplay.filter(c => {
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
    // Extra add-ons beyond this plan's default allowance (flagged independently of curries).
    const planDefaults = defaultSideCounts(
      customer.meal_type || 'Veg',
      normalizePortionToken(customer.portion_size),
      customer.plan_tier || 'weekly'
    );
    const sideSummary = formatSideSummary(side, planDefaults);

    // Half plans always get their own "⚡ Custom" badge describing the single container.
    const isHalfCustomer = isHalfPortion(customer.portion_size);
    const halfNote = isHalfCustomer ? formatHalfContainerNote(side, customer.portion_size) : null;
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
      if (customText) {
        // Strip out default "Salad" and "Dessert" from custom curry badges
        customText = customText
          .replace(/\s*\+\s*Salad\b/gi, '')
          .replace(/\s*\+\s*Dessert\b/gi, '')
          .trim();
        // If the customText becomes empty after stripping, set it to null
        if (customText === '') {
          customText = null;
        }
      }
    } else if (
      sideSummary !== '' &&
      !isHalfPortion(customer.portion_size) &&
      deviatesCurryFromDefault(
        customer.meal_type || 'Veg',
        normalizePortionToken(customer.portion_size),
        customer.plan_tier || 'weekly',
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
        : `⚡ ${customText}`);

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
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> {displayNote}
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
    const isLastModified = customer.id === lastModifiedCustomerId;
    return (
      <tr
        key={customer.id}
        id={`customer-row-${customer.id}`}
        onClick={() => openCancellationDetails(customer)}
        className={`group transition-all duration-150 cursor-pointer ${isLastModified
          ? 'bg-blue-50/70 border-l-4 border-l-blue-500 transition-colors duration-700 ease-out'
          : selectedCustomer?.id === customer.id
            ? 'bg-[#F4F4FE]'
            : 'hover:bg-[#FAF9FF] bg-white'
          }`}
      >
        <td className="py-2 pl-4 pr-3 rounded-l-xl align-top">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#11142D] text-[13px] truncate capitalize">{customer.full_name}</span>
              <span title="Cancelled" className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
            </div>
            {customer.delivery_address ? (
              <span className="text-[11px] text-[#7A7C87] font-medium truncate mt-0.5 flex items-center">
                <MapPin className="w-3 h-3 mr-1 opacity-70" />
                {customer.delivery_address.split(',')[0]}
              </span>
            ) : (
              <span className="text-[11px] text-gray-300 italic mt-0.5">No destination configured</span>
            )}
            {customer.referred_by ? (
              <span
                title={`Referred by ${customer.referred_by}`}
                className="text-[11px] text-[#7A7C87] font-medium truncate mt-1 flex items-center"
              >
                <span className="text-[9px] mr-1 opacity-70">🤝</span>
                Referred by: {customer.referred_by}
              </span>
            ) : null}
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
      <thead className="sticky top-0 z-20 bg-white shadow-xs">
        <tr className="text-[#A2A4B0] font-bold border-b border-gray-200 uppercase text-[10.5px] tracking-wider select-none bg-white h-11">
          <th className="sticky top-0 z-20 bg-white pl-4 py-2 border-b border-gray-200">Customer</th>
          <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Cancelled Date</th>
          <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Reason</th>
          <th className="sticky top-0 z-20 bg-white py-2 pr-3 border-b border-gray-200 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F9FBFC]">
        {sortedCustomers.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-16 text-center">
              <div className="flex flex-col items-center justify-center space-y-3">
                <FolderOpen className="w-6 h-6 text-[#5D5FEF]" />
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

      {/* UNIFIED COMPACT HEADER */}
      <div className="px-3 sm:px-6 py-2.5 sm:py-3 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 bg-white border-b border-[#EEEEEE]">
        {/* Row 1 on Mobile: Title + Count + Action Buttons */}
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] sm:text-[22px] font-bold text-[#11142D] tracking-tight">Customers</h1>
            <span className="inline-flex items-center justify-center px-2 py-0.5 bg-[#F4F5F7] border border-[#E5E7EB] text-[#5E6470] text-[11px] sm:text-xs font-semibold rounded-full min-w-[24px]">
              {filteredCustomers.length}
            </span>
          </div>

          {/* Action buttons on mobile (< sm) */}
          <div className="flex sm:hidden items-center gap-1.5">
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              title="Sync data"
              className="p-2 rounded-lg border border-[#E0E0E0] bg-white text-[#7A7C87] hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <svg
                className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#5D5FEF]' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>
            <button
              type="button"
              aria-pressed={kitchenMode}
              onClick={toggleKitchenMode}
              title="Kitchen Order"
              className={`p-2 rounded-lg border transition-colors cursor-pointer ${kitchenMode
                ? 'bg-[#5D5FEF] border-[#5D5FEF] text-white'
                : 'bg-white border-[#E0E0E0] text-[#7A7C87]'
                }`}
            >
              <UtensilsCrossed className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleOpenAddForm}
              className="px-3 py-1.5 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Row 2 on Mobile / Center on Desktop: Search Bar */}
        <div className="w-full sm:flex-1 sm:max-w-xl sm:mx-auto">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
              <svg
                className="w-3.5 h-3.5 text-gray-400"
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
              className="w-full text-xs sm:text-[13px] pl-9 pr-8 py-2 bg-[#F9FBFC] border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] focus:bg-white text-[#292D32] placeholder-gray-400 transition-all shadow-2xs"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-gray-600 text-sm cursor-pointer z-10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Desktop-only Action Buttons (>= sm) */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {/* Sync Button */}
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            title="Sync with latest database records and closures"
            className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold rounded-lg border border-[#E0E0E0] bg-white text-[#7A7C87] hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#5D5FEF]' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>Sync</span>
          </button>

          {/* Kitchen Order Button */}
          <button
            type="button"
            aria-pressed={kitchenMode}
            onClick={toggleKitchenMode}
            title="Kitchen Dispatch / Packing Order: Non-Veg first → Large → Regular → Small → A–Z"
            className={`flex items-center space-x-1.5 px-3 py-2 text-[13px] font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${kitchenMode
              ? 'bg-[#5D5FEF] border-[#5D5FEF] text-white'
              : 'bg-white border-[#E0E0E0] text-[#7A7C87] hover:bg-gray-50'
              }`}
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>Kitchen Order</span>
          </button>

          {/* Add Customer CTA */}
          <button
            type="button"
            onClick={handleOpenAddForm}
            className="px-4 py-2 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white text-[13px] font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            + Add Customer
          </button>
        </div>
      </div>

      {/* CONSOLIDATED FILTER BAR */}
      <div className="px-3 sm:px-6 py-2.5 shrink-0 border-b border-[#EEEEEE] flex flex-col md:flex-row md:items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-4 sm:gap-6 text-[13px] font-medium text-[#7A7C87] overflow-x-auto whitespace-nowrap scrollbar-none pb-1 md:pb-0 shrink-0">
          <button type="button" onClick={() => setActiveTab('all')} className={`pb-1 border-b-2 transition-colors cursor-pointer ${activeTab === 'all' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            All Customers <span className="text-xs text-[#B5B7C0]">({customersForDisplay.length})</span>
          </button>
          <button type="button" onClick={() => setActiveTab('veg')} className={`pb-1 border-b-2 transition-colors cursor-pointer ${activeTab === 'veg' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            Vegetarian <span className="text-xs text-[#B5B7C0]">({totalVegCount})</span>
          </button>
          <button type="button" onClick={() => setActiveTab('non-veg')} className={`pb-1 border-b-2 transition-colors cursor-pointer ${activeTab === 'non-veg' ? 'border-[#5D5FEF] text-[#5D5FEF] font-bold' : 'border-transparent hover:text-[#11142D]'}`}>
            Non-Vegetarian <span className="text-xs text-[#B5B7C0]">({totalNonVegCount})</span>
          </button>
        </div>

        {/* SUBSCRIPTION STATUS FILTER PILLS */}
        <div className="flex items-center space-x-1.5 overflow-x-auto whitespace-nowrap scrollbar-none pb-1 md:pb-0 shrink-0">
          <span className="text-[11px] font-semibold text-[#A2A4B0] uppercase tracking-wider mr-1 hidden sm:inline">Status:</span>
          {(['all', 'active', 'paused', 'cancelled'] as const).map(status => {
            const statusCounts: Record<string, number> = {
              all: customersForDisplay.length,
              active: customersForDisplay.filter(c => (c.subscription_status || 'active') === 'active').length,
              paused: customersForDisplay.filter(c => c.subscription_status === 'paused').length,
              cancelled: customersForDisplay.filter(c => c.subscription_status === 'cancelled').length,
            };
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-2.5 sm:px-3 py-1 rounded-full text-[10.5px] sm:text-[11px] font-bold uppercase tracking-wider transition-all border shrink-0 cursor-pointer whitespace-nowrap ${statusFilter === status
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

      {/* DATA VIEW TABLE CONTAINER */}
      <div className="flex-1 p-3 sm:p-6 overflow-hidden flex flex-col min-h-0">
        <div className="bg-white border border-[#EEEEEE] rounded-xl shadow-sm overflow-hidden w-full flex-1 flex flex-col min-h-0">
          {/* SUMMARY METRICS BAR */}
          {statusFilter !== 'cancelled' && sortedCustomers.length > 0 && (
            <div className="px-3 sm:px-4 py-2 bg-gray-50/90 border-b border-gray-200 shrink-0">
              {/* Mobile View: Natural Content-Sized Flex Wrap (< md) */}
              <div className="flex flex-wrap items-center gap-1.5 md:hidden">
                {/* Box 1: Veg */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] whitespace-nowrap">
                  <span className="font-bold">{totalVeg} Veg</span>
                  <span className="text-emerald-300 font-normal">|</span>
                  <span className="text-[10px] font-semibold text-emerald-700">
                    {vegSizes.lg}L · {vegSizes.rg}R{vegSizes.hlg > 0 ? ` · ${vegSizes.hlg}HL` : ''}
                  </span>
                </div>

                {/* Box 2: Non-Veg */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-[11px] whitespace-nowrap">
                  <span className="font-bold">{totalNv} NV</span>
                  <span className="text-rose-300 font-normal">|</span>
                  <span className="text-[10px] font-semibold text-rose-700">
                    {nvSizes.lg}L · {nvSizes.rg}R
                  </span>
                </div>

                {/* Box 3: Breads */}
                <div className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px] whitespace-nowrap">
                  <span>🍞 {breadHeaderTotal || '0 Roti'}</span>
                </div>

                {/* Box 4: Rice */}
                <div className="inline-flex items-center px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-[11px] whitespace-nowrap">
                  <span>🍚 {riceHeaderTotal || '0 Rice'}</span>
                </div>
              </div>

              {/* Desktop View: Single Inline Bar (>= md) */}
              <div className="hidden md:flex items-center gap-2.5 text-xs">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-800 text-[11px]">
                  <span className="font-bold">{totalVeg} Veg</span>
                  <span className="text-emerald-300 font-normal">|</span>
                  <span className="text-[10.5px] font-semibold text-emerald-700">{formatSizeTokens(vegSizes)}</span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50/80 border border-rose-200 text-rose-800 text-[11px]">
                  <span className="font-bold">{totalNv} Non-Veg</span>
                  <span className="text-rose-300 font-normal">|</span>
                  <span className="text-[10.5px] font-semibold text-rose-700">{formatSizeTokens(nvSizes)}</span>
                </div>

                <div className="h-4 w-px bg-gray-300" />

                <div className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-50/80 border border-amber-200 text-amber-800 font-bold text-[11px]">
                  <span>{breadHeaderTotal || '0 Roti'}</span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-800 text-[11px]">
                  <span className="font-extrabold uppercase text-[10.5px] text-blue-700">Rice</span>
                  <span className="text-blue-300 font-normal">|</span>
                  <span className="font-semibold text-blue-900">{riceHeaderTotal || '0'}</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* 1. MOBILE CARD FEED (< md: Clean touch cards)             */}
          {/* ========================================================= */}
          <div className="md:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
            {sortedCustomers.length === 0 ? (
              <div className="p-8 text-center text-gray-400 font-medium text-sm">
                No customers found matching search.
              </div>
            ) : (
              sortedCustomers.map(customer => {
                const displayPlanSize = normalizePortionToken(customer.portion_size || PORTION_RG);
                const fulfillment = getCustomerFulfillment(customer);
                const subStatus = (customer.subscription_status || 'active').toLowerCase();
                const isNonVeg = (customer.meal_type || '').toLowerCase().includes('non');
                const scheduleBadge = getScheduleBadgeText(customer);
                const tierKey = (customer.plan_tier || 'monthly').toLowerCase();
                const standardAllowance = tierKey === 'weekly' ? 5 : tierKey === 'trial' ? 1 : 20;
                const total =
                  customer.total_tiffin_credits && customer.total_tiffin_credits > 0
                    ? (tierKey === 'monthly' && customer.total_tiffin_credits === 25)
                      ? 20
                      : customer.total_tiffin_credits
                    : standardAllowance;
                const custSkips = skipsMap.get(customer.id);
                const autoDays = calculateElapsedDeliveryDays(customer.start_date, closuresSet, total, custSkips);
                const used = autoDays;
                return (
                  <div
                    key={customer.id}
                    onClick={() => handleRowClick(customer)}
                    className="p-3.5 flex flex-col gap-2.5 bg-white hover:bg-slate-50/70 active:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {/* Row 1: Name, Status & Meal Pill */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-[#11142D] text-[14px] capitalize truncate">
                            {customer.full_name}
                          </span>
                          <span
                            className={`inline-block w-2 h-2 rounded-full shrink-0 ${subStatus === 'cancelled' ? 'bg-red-500' : subStatus === 'paused' ? 'bg-amber-400' : 'bg-green-500'
                              }`}
                          />
                          {customer.plan_tier && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {customer.plan_tier}
                            </span>
                          )}
                        </div>

                        {/* Address / Location */}
                        <div className="text-xs text-gray-500 mt-0.5 truncate">
                          {fulfillment.mode === 'pure_pickup' ? (
                            <span className="font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded text-[10px]">
                              🛍️ Kitchen Pickup
                            </span>
                          ) : (
                            customer.delivery_address?.split(',')[0] || 'No destination address'
                          )}
                        </div>
                      </div>

                      {/* Meal & Portion Badges */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-black uppercase border ${isNonVeg ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}>
                          {isNonVeg ? 'NV' : 'Veg'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                          {displayPlanSize}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: Roti, Rice & Delivery Schedule Specs */}
                    <div className="flex items-center gap-2 flex-wrap text-xs bg-gray-50 border border-gray-200/70 rounded-lg px-2.5 py-1.5 font-medium">
                      <span className="font-bold text-gray-900">
                        🍞 {customer.roti_count ? `${customer.roti_count} Roti` : 'No bread'}
                        {customer.pronthi_count ? ` + ${customer.pronthi_count}P` : ''}
                      </span>

                      {customer.rice_count && customer.rice_count !== 'None' && customer.rice_count !== '—' && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="font-bold text-blue-700">
                            🍚 {formatRiceCellText(customer.rice_count)}
                          </span>
                        </>
                      )}

                      {scheduleBadge && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-600 font-semibold">
                            📅 {scheduleBadge}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Row 3: Progress & Edit CTA */}
                    <div className="flex items-center justify-between text-[11px] text-gray-500 pt-0.5">
                      <span>
                        Progress: <strong className="text-gray-800">{used}/{total}</strong> delivered
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditCustomer(customer);
                        }}
                        className="text-[#5D5FEF] font-bold px-2 py-0.5 rounded hover:bg-[#F4F4FE]"
                      >
                        Edit →
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ========================================================= */}
          {/* 2. DESKTOP VIEW (>= md: High-density 9-column Table)       */}
          {/* ========================================================= */}
          <div className="hidden md:block flex-1 min-h-0 overflow-y-auto">
            <table className="w-full table-fixed text-left text-[13px] border-collapse">
              {statusFilter === 'cancelled' ? (
                renderCancelledTableInner()
              ) : (
                <>
                  <colgroup>
                    <col className="min-w-[220px]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[100px]" />
                    <col className="min-w-[140px]" />
                    <col className="w-[8%]" />
                    <col className="w-[9%]" />
                  </colgroup>
                  {/* SECTION: CUSTOMERS_TABLE_HEAD */}
                  <thead className="sticky top-0 z-20 bg-white shadow-xs">
                    <tr className="text-[#A2A4B0] font-bold uppercase text-[10.5px] tracking-wider select-none h-10 bg-white border-b border-gray-200">
                      <th onClick={cycleNameSort} className="sticky top-0 z-20 bg-white pl-4 py-2 border-b border-gray-200 cursor-pointer select-none hover:text-indigo-600 transition-colors group">
                        <div className="flex items-center space-x-1">
                          <span>Customer</span>
                          <span className="text-[10px] text-gray-400 font-bold opacity-70 group-hover:opacity-100">
                            {nameSort === 'default' ? ' ↕' : nameSort === 'asc' ? ' ↑' : ' ↓'}
                          </span>
                        </div>
                      </th>
                      <th onClick={cyclePortionSort} className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200 cursor-pointer select-none hover:text-indigo-600 transition-colors group">
                        <div className="flex items-center space-x-1">
                          <span>Meal Plan</span>
                          <span className="text-[10px] text-gray-400 font-bold opacity-70 group-hover:opacity-100">
                            {portionSort === 'default' ? ' ⇅' : portionSort === 'desc' ? ' ↓' : ' ↑'}
                          </span>
                        </div>
                      </th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Plan</th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Roti / Bread</th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Rice</th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Schedule</th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200">Notes</th>
                      <th className="sticky top-0 z-20 bg-white py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Discount</th>
                      <th className="sticky top-0 z-20 bg-white py-2 pr-3 border-b border-gray-200 text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F9FBFC]">
                    {sortedCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-16 text-center">
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <Users className="w-6 h-6 text-[#5D5FEF]" />
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

                        // Fulfillment mode drives the sub-cell below the customer name:
                        // pure pickup → single Kitchen Pickup badge; delivery-only → address +
                        // map link; hybrid (e.g. Harshpreet) → address + map link with a compact
                        // pickup-day pill underneath so partial pickup days stay visible.
                        const fulfillment = getCustomerFulfillment(customer);

                        const isLastModified = customer.id === lastModifiedCustomerId;

                        return (
                          <tr
                            key={customer.id}
                            id={`customer-row-${customer.id}`}
                            onClick={() => handleRowClick(customer)}
                            className={`group transition-colors cursor-pointer ${isLastModified
                              ? 'bg-blue-50/70 border-l-4 border-l-blue-500 transition-colors duration-700 ease-out'
                              : selectedCustomer?.id === customer.id
                                ? 'bg-[#F4F4FE]'
                                : 'bg-white hover:bg-slate-50/80'
                              }`}
                          >
                            {/* SECTION: TABLE_ROW_CUSTOMER_CELL */}
                            <td
                              className={`py-2 pl-4 pr-3 rounded-l-xl align-top ${isLastModified ? 'border-l-4 border-l-blue-500' : ''}`}
                              data-section="table-row-customer-cell"
                            >
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-bold text-[#11142D] text-[13px] truncate capitalize">{customer.full_name}</span>
                                  {(() => {
                                    const subStatus = (customer.subscription_status || 'active').toLowerCase();
                                    const isPaused = subStatus === 'paused';
                                    const isCancelled = subStatus === 'cancelled';
                                    const isUpcoming = !isPaused && !isCancelled && !!customer.start_date && customer.start_date > todayKey;
                                    const statusLabel = isCancelled
                                      ? `Cancelled${customer.cancellation_reason ? ` — ${customer.cancellation_reason}` : ''}`
                                      : isPaused
                                        ? `Paused${customer.pause_start_date ? ` until ${customer.pause_end_date || 'Indefinite'}` : ''}`
                                        : isUpcoming
                                          ? `Upcoming — starts ${formatShortLastDay(customer.start_date!)}`
                                          : 'Active';
                                    return (
                                      <span
                                        title={statusLabel}
                                        className={`inline-block w-2 h-2 rounded-full shrink-0 ${isCancelled ? 'bg-red-500' : isPaused ? 'bg-amber-400' : isUpcoming ? 'bg-blue-500' : 'bg-green-500'
                                          }`}
                                      />
                                    );
                                  })()}
                                </div>
                                {customer.start_date && customer.start_date > todayKey ? (
                                  <span
                                    title={`Subscription starts ${formatShortLastDay(customer.start_date)}`}
                                    className="inline-flex items-center self-start max-w-full px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold mt-0.5 whitespace-nowrap"
                                  >
                                    <Calendar className="w-4 h-4" /> Starts {formatShortLastDay(customer.start_date)}
                                  </span>
                                ) : null}
                                {customer.scheduled_cancel_date &&
                                  (customer.subscription_status || 'active') === 'active' ? (
                                  <span
                                    title={`Last service day — service will be ${customer.scheduled_status === 'paused' ? 'paused' : 'cancelled'} after this date.`}
                                    className="inline-flex items-center self-start max-w-full px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 border border-amber-300 mt-0.5 whitespace-nowrap"
                                  >
                                    ⏳ Ends {formatShortDate(customer.scheduled_cancel_date)}
                                  </span>
                                ) : null}
                                {fulfillment.mode === 'pure_pickup' ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 mt-0.5">
                                    <ShoppingBag className="w-3 h-3" /> Kitchen Pickup
                                  </span>
                                ) : (
                                  <>
                                    {customer.delivery_address ? (
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
                                    {fulfillment.mode === 'hybrid' && fulfillment.pickupDays.length > 0 && (
                                      <span
                                        title={fulfillment.pickupDays.join(', ')}
                                        className="inline-flex items-center self-start max-w-full px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 mt-1"
                                      >
                                        <ShoppingBag className="w-4 h-4" /> Pickup: {fulfillment.pickupDays.map(day => day.substring(0, 3)).join(', ')}
                                      </span>
                                    )}
                                  </>
                                )}
                                {customer.referred_by ? (
                                  <span
                                    title={`Referred by ${customer.referred_by}`}
                                    className="text-[11px] text-[#7A7C87] font-medium truncate mt-1 flex items-center max-w-full"
                                  >
                                    <span className="text-[9px] mr-1 opacity-70">🤝</span>
                                    Referred by: {customer.referred_by}
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            <td className="py-2 pr-3 whitespace-nowrap align-top">
                              <div className="flex flex-col items-start gap-1">
                                {customer.meal_type ? (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border tracking-wide uppercase leading-none ${customer.meal_type.toLowerCase().includes('non')
                                    ? 'bg-red-50 text-red-600 border-red-100/60'
                                    : 'bg-green-50 text-green-600 border-green-100/60'
                                    }`}>
                                    {customer.meal_type.toLowerCase().includes('non') ? 'Non-Veg' : 'Veg'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-gray-300 font-bold uppercase">—</span>
                                )}
                                <span className={`text-[11px] font-semibold ${displayPlanSize === PORTION_LG || displayPlanSize === PORTION_HALF_LG ? 'text-purple-600' : 'text-gray-500'
                                  }`}>
                                  {displayPlanSize}
                                </span>
                              </div>
                            </td>

                            {/* SECTION: TABLE_ROW_PLAN_CELL */}
                            <td className="py-2 pr-3 align-top whitespace-nowrap" data-section="table-row-plan-cell">
                              {(() => {
                                const planLabel = customer.plan_tier || 'Monthly';
                                const tierKey = (customer.plan_tier || 'monthly').toLowerCase();
                                const standardAllowance = tierKey === 'weekly' ? 5 : tierKey === 'trial' ? 1 : 20;

                                const total =
                                  customer.total_tiffin_credits && customer.total_tiffin_credits > 0
                                    ? (tierKey === 'monthly' && customer.total_tiffin_credits === 25)
                                      ? 20
                                      : customer.total_tiffin_credits
                                    : standardAllowance;

                                const custSkips = skipsMap.get(customer.id);
                                const autoDays = calculateElapsedDeliveryDays(customer.start_date, closuresSet, total, custSkips);
                                // Prefer autoDays so individual customer skips always decrement delivery count
                                const used = autoDays;
                                const isOverdue = used > total;
                                const isDue = !isOverdue && used >= total;
                                const pillClass = isOverdue
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : isDue
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-100';
                                const subText = isOverdue
                                  ? `+${used - total} Grace • Overdue`
                                  : isDue
                                    ? `${used}/${total} • Due`
                                    : `${used}/${total} delivered`;
                                const subClass = isOverdue
                                  ? 'text-rose-600'
                                  : isDue
                                    ? 'text-amber-700'
                                    : 'text-gray-500';

                                const startDateFormatted = customer.start_date ? formatShortDate(customer.start_date) : null;
                                const calculated = customer.start_date
                                  ? calculateTargetLastDay(customer.start_date, total, closuresSet, custSkips)
                                  : null;
                                // Calculated date takes precedence over stale database column cycle_end_date
                                const computedEnd = calculated?.dateKey || customer.cycle_end_date?.slice(0, 10);
                                const endDateFormatted = computedEnd ? formatShortDate(computedEnd) : null;
                                return (
                                  <div className="flex flex-col items-start gap-0.5 min-w-0">
                                    <span
                                      className={`${pillClass} uppercase text-[11px] font-semibold px-2 py-0.5 rounded border inline-block`}
                                    >
                                      {planLabel}
                                    </span>
                                    <span className={`text-[11px] font-medium ${subClass}`}>{subText}</span>

                                    {startDateFormatted && (
                                      <span className="text-[10.5px] font-semibold text-gray-400 mt-0.5 tracking-tight">
                                        {startDateFormatted} → {endDateFormatted || '—'}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
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
                                if (!hasRoti && !hasPronthi) {
                                  return <span className="text-gray-300 font-mono">—</span>;
                                }
                                return (
                                  <div className="flex flex-col items-start gap-1">
                                    {hasRoti && (
                                      <span className="px-1.5 py-0.5 bg-white text-gray-600 border border-gray-200 rounded text-[10.5px] font-bold font-mono whitespace-nowrap">
                                        {customer.roti_count} Roti
                                      </span>
                                    )}
                                    {hasPronthi && (
                                      <span className="px-1.5 py-0.5 bg-amber-300 text-amber-950 border border-amber-400 rounded text-[10.5px] font-bold font-mono whitespace-nowrap">
                                        {customer.pronthi_count} Pronthi
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-2 pr-3 align-top">
                              {(() => {
                                const rawRice = (customer.rice_count || "").trim().toLowerCase();
                                const hasRice =
                                  rawRice !== "" &&
                                  rawRice !== "none" &&
                                  rawRice !== "—" &&
                                  rawRice !== "0" &&
                                  !rawRice.includes("0 rg");
                                if (!hasRice) {
                                  return <span className="text-gray-300 font-mono">—</span>;
                                }
                                return (
                                  <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100/70 rounded text-[10.5px] font-bold font-mono uppercase whitespace-nowrap">
                                    {formatRiceCellText(customer.rice_count)}
                                  </span>
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

                            {/* SECTION: TABLE_ROW_ACTIONS_MENU */}
                            <td className="py-2 pr-4 align-middle text-right" data-section="table-row-actions-menu">
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
                                      {/* 📋 Duplicate Customer — create-mode prefill from this row */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDuplicateCustomer(customer);
                                        }}
                                        className="w-full px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 flex items-center gap-2.5 transition-colors cursor-pointer"
                                      >
                                        <ClipboardList className="w-4 h-4" />
                                        <span className="whitespace-nowrap">Duplicate Customer</span>
                                      </button>

                                      {/* 💳 Log Payment / Renew Cycle (due, overdue, or fully used) */}
                                      {((customer.payment_status === 'due' ||
                                        customer.payment_status === 'overdue') ||
                                        (customer.used_credits ?? 0) >= (customer.total_tiffin_credits ?? 20)) && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openRenewModal(customer);
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                                          >
                                            <span className="text-sm shrink-0"><CreditCard className="w-4 h-4" /></span>
                                            <span className="whitespace-nowrap">Log Payment / Renew Cycle</span>
                                          </button>
                                        )}

                                      {/* ⭐ Upgrade Plan (trial or weekly only) */}
                                      {(customer.plan_tier === 'trial' || customer.plan_tier === 'weekly') && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openUpgradeModal(customer);
                                          }}
                                          className="w-full px-3.5 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                                        >
                                          <span className="text-sm shrink-0">⭐</span>
                                          <span className="whitespace-nowrap">Upgrade Plan</span>
                                        </button>
                                      )}

                                      <div className="border-t border-gray-100 my-1" />

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
                                          {(customer.subscription_status || 'active') === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
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
                                        <Ban className="w-4 h-4" />
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
                                        <Trash2 className="w-4 h-4" />
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
        </div>
        {/* FLUID SLIDING DRAWER SYSTEM */}
        {isPanelRendered && (
          <>
            <div
              onClick={closePanelGracefully}
              className={`fixed inset-0 z-20 bg-black/10 transition-opacity duration-200 ${isSlideInActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            />

            {/* SECTION: CUSTOMER_EDIT_DRAWER (Responsive Sheet: Bottom Sheet on Mobile, Right Drawer on Desktop) */}
            <div
              data-section="customer-edit-drawer"
              className={`fixed z-30 bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out
                /* Mobile: Bottom Sheet */
                inset-x-0 bottom-0 max-h-[92vh] h-[92vh] rounded-t-2xl border-t border-gray-200
                ${isSlideInActive ? 'translate-y-0' : 'translate-y-full'}
                
                /* Desktop: Right Slide-over */
                md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:h-full md:max-h-full md:w-[640px] lg:w-[700px] md:rounded-none md:border-t-0 md:border-l md:border-[#EEEEEE]
                md:${isSlideInActive ? 'translate-x-0' : 'translate-x-full'} md:translate-y-0
              `}
            >
              {/* Mobile Drag Indicator Handle */}
              <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mt-2.5 mb-1 shrink-0 md:hidden" />

              <form onSubmit={handleFormSubmit} noValidate className="flex-1 flex flex-col overflow-hidden text-[13px]">

                {/* STICKY HEADER REGION */}
                <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shrink-0">
                  {/* HEAD BAR ACTIONS */}
                  <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#F5F5F5] flex items-center justify-between bg-[#FCFCFD] shrink-0">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <h2 className="text-xs sm:text-[14px] font-bold text-[#11142D] uppercase tracking-wide shrink-0">
                        {isAddingNew ? 'Add Customer' : 'Edit'}
                      </h2>
                      {!isAddingNew && fullName && (
                        <>
                          <span className="text-base sm:text-2xl font-bold text-gray-900 capitalize truncate">
                            {fullName}
                          </span>
                          {selectedCustomer && (() => {
                            const drawerStatus = (selectedCustomer.subscription_status || 'active').toLowerCase();
                            const isDrawerCancelled = drawerStatus === 'cancelled';
                            const isDrawerPaused = drawerStatus === 'paused';
                            const isDrawerUpcoming = !isDrawerPaused && !isDrawerCancelled &&
                              !!selectedCustomer.start_date && selectedCustomer.start_date > todayKey;
                            const drawerBadgeClass = isDrawerCancelled
                              ? 'bg-red-50 text-red-600 border-red-100/60'
                              : isDrawerPaused
                                ? 'bg-amber-50 text-amber-600 border-amber-100/60'
                                : isDrawerUpcoming
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-green-50 text-green-600 border-green-100/60';
                            const drawerBadgeLabel = isDrawerCancelled
                              ? '🔴 Cancelled'
                              : isDrawerPaused
                                ? '🟡 Paused'
                                : isDrawerUpcoming
                                  ? '🗓️ UPCOMING'
                                  : '🟢 Active';
                            return (
                              <span className={`px-2 py-0.5 rounded-md text-[9.5px] sm:text-[10px] font-bold border tracking-wide uppercase shrink-0 ${drawerBadgeClass}`}>
                                {drawerBadgeLabel}
                              </span>
                            );
                          })()}
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 sm:space-x-2 shrink-0">
                      <button type="button" onClick={closePanelGracefully} className="px-2.5 sm:px-3 py-1.5 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isPending || aiLoading}
                        className="px-3 py-1.5 bg-[#5D5FEF] hover:bg-[#4D4FDF] text-white font-semibold rounded-lg text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        {isPending ? 'Saving...' : 'Save Customer'}
                      </button>
                    </div>
                  </div>

                  {/* TAB NAVIGATION BAR */}
                  <div className="px-4 sm:px-6 pt-2 sm:pt-3 pb-0 bg-white flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    {(
                      [
                        { key: 'profile' as const, label: 'Profile', icon: <User className="w-3.5 h-3.5" /> },
                        { key: 'plan' as const, label: 'Plan & Billing', icon: <CreditCard className="w-3.5 h-3.5" /> },
                        { key: 'meal' as const, label: 'Meal Config', icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
                        ...(!isAddingNew && selectedCustomer
                          ? [{ key: 'history' as const, label: 'History', icon: <History className="w-3.5 h-3.5" /> }]
                          : []),
                      ]
                    ).map(tab => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveDrawerTab(tab.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border border-b-0 rounded-b-none shrink-0 ${activeDrawerTab === tab.key
                          ? 'bg-[#EFEEFC] text-[#5D5FEF] border-[#5D5FEF]/30'
                          : 'bg-white text-[#7A7C87] border-transparent hover:bg-gray-50 hover:text-[#11142D]'
                          }`}
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* SCROLLABLE TAB CONTENT WORKSPACE */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">

                  {/* TAB 1 — PROFILE */}
                  {activeDrawerTab === 'profile' && (
                    <div className="space-y-3" data-section="edit-basic-info">
                      {/* Row 1: Full Name + Contact Method (side by side) */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">Full Name</label>
                          <input
                            ref={fullNameInputRef}
                            type="text"
                            value={fullName}
                            onChange={(e) => {
                              setFullName(e.target.value);
                              if (formErrors.fullName) setFormErrors(prev => ({ ...prev, fullName: undefined }));
                            }}
                            required
                            className={`w-full px-3 py-1.5 border rounded-lg outline-none focus:border-[#5D5FEF] ${formErrors.fullName ? 'border-red-400 bg-red-50/30' : 'border-[#E0E0E0]'
                              }`}
                          />
                          {formErrors.fullName && (
                            <p className="text-[10.5px] font-semibold text-red-500 mt-1 flex items-center gap-1">
                              ⚠ {formErrors.fullName}
                            </p>
                          )}
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

                      {/* Row 1b: Referred By (Optional) — 4 tap-to-set source pills + a
                        typeahead combobox over existing customer names. The menu stays
                        closed until 2+ characters are typed; free-form text is still
                        allowed (whatever is typed or left as the last pill tapped saves). */}
                      <div ref={referralContainerRef} className="relative">
                        <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1.5">
                          Referred By <span className="text-gray-400 font-normal normal-case">(Optional)</span>
                        </label>

                        {/* QUICK SOURCE PILLS — a tap immediately writes referred_by. */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {REFERRAL_QUICK_PILLS.map(pill => {
                            const isPillActive = referredBy.trim().toLowerCase() === pill.toLowerCase();
                            return (
                              <button
                                key={pill}
                                type="button"
                                aria-pressed={isPillActive}
                                onClick={() => {
                                  setReferredBy(pill);
                                  setIsReferralMenuOpen(false);
                                }}
                                className={`h-10 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${isPillActive
                                  ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-sm'
                                  : 'bg-[#EFEEFC] text-[#5D5FEF] border-[#5D5FEF]/25 hover:bg-[#E3E2FB]'
                                  }`}
                              >
                                {pill}
                              </button>
                            );
                          })}
                        </div>

                        {/* TYPEAHEAD COMBOBOX — menu anchors directly beneath the input so it
                          never drifts horizontally off-screen on narrow/mobile widths. */}
                        <div className="relative">
                          <input
                            type="text"
                            value={referredBy}
                            onChange={(e) => {
                              const next = e.target.value;
                              setReferredBy(next);
                              setIsReferralMenuOpen(next.trim().length >= 2);
                            }}
                            placeholder="e.g. Supratim, Instagram, Flyer..."
                            className="w-full h-11 rounded-lg border border-[#E0E0E0] text-sm px-3 outline-none focus:border-[#5D5FEF]"
                          />
                          {isReferralMenuOpen && visibleReferralSuggestions.length > 0 && (
                            <ul
                              aria-label="Customer referral suggestions"
                              className="absolute left-0 right-0 z-50 mt-1 w-full bg-white border border-[#E0E0E0] rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-50"
                            >
                              {visibleReferralSuggestions.map(suggestion => (
                                <li key={suggestion}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReferredBy(suggestion);
                                      setIsReferralMenuOpen(false);
                                    }}
                                    className="w-full min-h-[40px] px-3 py-2 flex items-center gap-1.5 text-left text-[13px] font-medium text-gray-600 hover:bg-[#F4F4FE] hover:text-[#5D5FEF] cursor-pointer transition-colors"
                                  >
                                    <span className="text-[11px] opacity-80 shrink-0">🤝</span>
                                    <span className="truncate">{suggestion}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Delivery destination address (full width). Optional when every
                        scheduled day is Pickup; required as soon as any day is a Delivery day. */}
                      <div ref={addressContainerRef} className="relative">
                        <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">
                          Delivery Destination Address
                          {!hasDeliveryDay && selectedDays.length > 0 && (
                            <span className="font-normal normal-case text-gray-400"> (Optional — all scheduled days are Pickup)</span>
                          )}
                        </label>
                        <input
                          ref={deliveryAddressInputRef}
                          type="text"
                          value={deliveryAddress}
                          onChange={(e) => {
                            handleAddressChange(e.target.value);
                            if (formErrors.deliveryAddress) setFormErrors(prev => ({ ...prev, deliveryAddress: undefined }));
                          }}
                          required={hasDeliveryDay}
                          placeholder="Type address..."
                          className={`w-full px-3 py-1.5 border rounded-lg outline-none focus:border-[#5D5FEF] ${formErrors.deliveryAddress ? 'border-red-400 bg-red-50/30' : 'border-[#E0E0E0]'
                            }`}
                        />
                        {formErrors.deliveryAddress && (
                          <p className="text-[10.5px] font-semibold text-red-500 mt-1 flex items-center gap-1">
                            ⚠ {formErrors.deliveryAddress}
                          </p>
                        )}

                        {/* FLOATING GEOGRAPHIC SUGGESTIONS DROPDOWN BLOCK */}
                        {addressSuggestions.length > 0 && (
                          <ul className="absolute left-0 right-0 mt-1 bg-white border border-[#EEEEEE] rounded-lg shadow-xl max-h-48 overflow-y-auto z-50 text-[12px] divide-y divide-gray-50">
                            {addressSuggestions.map((suggestion, index) => (
                              <li
                                key={index}
                                onClick={() => {
                                  setDeliveryAddress(suggestion);
                                  setAddressSuggestions([]);
                                  if (formErrors.deliveryAddress) setFormErrors(prev => ({ ...prev, deliveryAddress: undefined }));
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

                      {/* Row 3: Delivery Schedule — 6 day buttons + per-day Delivery/Pickup pills.
                        Unified with the master Kitchen Pickup switch: toggling any pill keeps the
                        switch in sync (all Pickup ⇒ ON; any Delivery ⇒ OFF). */}
                      <div>
                        <div className="flex items-center justify-between gap-3 bg-[#FCFCFD] border border-gray-200 rounded-lg px-3.5 py-2.5 mb-2">
                          <div className="min-w-0">
                            <span className="block text-[11px] font-semibold text-[#A2A4B0] uppercase tracking-wide">
                              🛍️ Kitchen Pickup
                            </span>
                            <span className="block text-[10.5px] text-gray-400 mt-0.5 leading-snug">
                              {pickupModeSubtitle}
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={allDaysArePickup}
                            onClick={() => {
                              const next = !allDaysArePickup;
                              if (next) {
                                // Global Kitchen Pickup → every active schedule day becomes pickup
                                // (makes the Delivery Destination Address optional).
                                setPickupDays([...selectedDays]);
                                setAddressSuggestions([]);
                              } else {
                                // Back to delivery for every day → clear pickup flags (each active
                                // day defaults back to Delivery) and drop the legacy placeholder
                                // marker so a real destination address is required again.
                                setPickupDays([]);
                                if (deliveryAddress.trim().toUpperCase() === 'KITCHEN PICKUP') {
                                  setDeliveryAddress('');
                                }
                              }
                              if (formErrors.deliveryAddress) setFormErrors(prev => ({ ...prev, deliveryAddress: undefined }));
                            }}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#5D5FEF] ${allDaysArePickup ? 'bg-[#5D5FEF]' : 'bg-gray-300'
                              }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${allDaysArePickup ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                          </button>
                        </div>

                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                          Delivery Schedule
                        </label>
                        <div className="grid grid-cols-6 gap-2 sm:gap-3 w-full">
                          {SCHEDULE_DAYS.map((d) => {
                            const isDayActive = selectedDays.includes(d.full);
                            const isPickupDay = pickupDays.includes(d.full);
                            return (
                              <div key={d.full} className="flex flex-col items-stretch gap-1.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleScheduleDay(d.full)}
                                  aria-pressed={isDayActive}
                                  className={`w-full h-12 sm:h-11 px-2 sm:px-3 rounded-xl text-xs sm:text-sm border transition-all flex items-center justify-center cursor-pointer touch-manipulation ${isDayActive
                                    ? '!bg-blue-600 !border-blue-600 shadow-sm'
                                    : 'bg-white border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                  <span className={isDayActive ? '!text-white font-bold' : 'text-gray-800 font-semibold'}>
                                    {d.short}
                                  </span>
                                </button>
                                {isDayActive && (
                                  <button
                                    type="button"
                                    onClick={() => togglePickupDay(d.full)}
                                    aria-pressed={isPickupDay}
                                    title={
                                      isPickupDay
                                        ? `${d.full}: customer picks up from the kitchen`
                                        : `${d.full}: deliver to the customer's address`
                                    }
                                    className={`w-full h-6 px-1 rounded-md border text-[9px] sm:text-[10px] font-bold transition-all flex items-center justify-center cursor-pointer touch-manipulation whitespace-nowrap ${isPickupDay
                                      ? 'bg-purple-50 border-purple-300 text-purple-700'
                                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                      }`}
                                  >
                                    {isPickupDay ? '🛍️ Pickup' : '🚗 Delivery'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                          {selectedDays?.length
                            ? `${selectedDays.map((d) => d.substring(0, 3)).join(', ')}${pickupDayCount > 0 ? ` • ${pickupDayCount} Pickup day${pickupDayCount === 1 ? '' : 's'}` : ''
                            }`
                            : 'No delivery days selected'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* SECTION: EDIT_SUBSCRIPTION_PLAN */}
                  {activeDrawerTab === 'plan' && (
                    <div data-section="edit-subscription-plan" className="w-full space-y-4 pt-2">
                      {/* Row 1: Plan Selector */}
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          Subscription Plan
                        </label>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3 w-full">
                          {PLAN_OPTIONS.map((plan) => {
                            const isSelected = planTier === plan.key;
                            return (
                              <button
                                key={plan.key}
                                type="button"
                                onClick={() => {
                                  setPlanTier(plan.key);
                                  setTotalTiffinCredits(plan.credits);
                                }}
                                className={`w-full h-12 sm:h-11 px-3 rounded-xl text-sm border transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation ${isSelected
                                  ? '!bg-blue-600 !border-blue-600 shadow-sm'
                                  : 'bg-white border-gray-300 hover:bg-gray-50'
                                  }`}
                              >
                                <span className={isSelected ? '!text-white font-bold' : 'text-gray-800 font-semibold'}>
                                  {plan.label}
                                </span>
                                <span className={isSelected ? '!text-blue-100 text-xs' : 'text-gray-500 text-xs'}>
                                  ({plan.credits})
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Row 2: 3-Column Grid: Start Date + Total Credits + Projected End Date */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                        {/* Start Date */}
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                            Start Date
                          </label>
                          <input
                            type="date"
                            value={startDate || ''}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full h-12 px-3 text-sm font-semibold border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-blue-500 bg-white"
                          />
                        </div>

                        {/* Credits Stepper */}
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                            Credits (Meals)
                          </label>
                          <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden h-12 bg-white">
                            <button
                              type="button"
                              onClick={() => handleUpdateCredits((Number(totalTiffinCredits) || 1) - 1)}
                              className="w-10 h-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 font-bold text-lg border-r border-gray-200 touch-manipulation cursor-pointer flex items-center justify-center"
                            >
                              −
                            </button>
                            <span className="flex-1 text-center text-sm font-bold text-gray-900">
                              {totalTiffinCredits ?? 20}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCredits((Number(totalTiffinCredits) || 0) + 1)}
                              className="w-10 h-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 font-bold text-lg border-l border-gray-200 touch-manipulation cursor-pointer flex items-center justify-center"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Auto-calculated End Date with Clear Explanation */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                              End Date
                            </label>
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                              AUTO (Mon-Fri)
                            </span>
                          </div>
                          <div className="w-full h-12 px-3 border border-gray-200 rounded-xl bg-gray-50/80 flex items-center justify-between text-sm font-bold text-gray-800">
                            <span>
                              {computedEndDate ? formatShortLastDay(computedEndDate) : '—'}
                            </span>
                            <span className="text-xs text-gray-400 font-normal">
                              {computedEndDate ? `(${computedEndDate})` : 'Set start date'}
                            </span>
                          </div>

                          {/* Dynamic Explanation Pill */}
                          {computedEndResult && (computedEndResult.holidayDaysSkipped > 0 || computedEndResult.customerDaysSkipped > 0) && (
                            <p className="mt-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                              <span>📅</span>
                              <span>
                                Extended by <strong>+{computedEndResult.holidayDaysSkipped + computedEndResult.customerDaysSkipped} days</strong>
                                {computedEndResult.customerDaysSkipped > 0 && ` (${computedEndResult.customerDaysSkipped} skip${computedEndResult.customerDaysSkipped > 1 ? 's' : ''})`}
                                {computedEndResult.holidayDaysSkipped > 0 && ` (${computedEndResult.holidayDaysSkipped} holiday${computedEndResult.holidayDaysSkipped > 1 ? 's' : ''})`}.
                              </span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Hybrid Delivery Usage Tracker */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-gray-700 font-bold block">Cycle Delivery Progress</span>
                          <span className="text-[11px] text-gray-500">
                            {Math.max(0, (totalTiffinCredits ?? 20) - usedCredits)} meals remaining
                          </span>
                        </div>

                        {/* Interactive Manual Override Stepper */}
                        <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-xl p-1 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => setUsedCredits(prev => Math.max(0, prev - 1))}
                            className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 font-bold flex items-center justify-center border border-gray-200 cursor-pointer"
                          >
                            −
                          </button>
                          <span className="px-2 font-black text-gray-900 text-xs whitespace-nowrap">
                            {usedCredits} / {totalTiffinCredits ?? 20} delivered
                          </span>
                          <button
                            type="button"
                            onClick={() => setUsedCredits(prev => prev + 1)}
                            className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 font-bold flex items-center justify-center border border-gray-200 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SECTION: EDIT_DIETARY_CONFIG */}
                  {/* ═════ DIETARY CONFIGURATION — PREMIUM FORM ═════ */}
                  {/* TAB 3 — MEAL CONFIG */}
                  {activeDrawerTab === 'meal' && (
                    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden" data-section="edit-dietary-config">
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
                                  className={`flex-1 h-10 px-3 rounded-lg text-xs font-semibold border transition-all ${mealType === option
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
                                  className={`flex-1 h-9 px-2 rounded-lg text-xs font-semibold border transition-all ${portionSize === opt.value
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
                                  onClick={() => {
                                    setIsRotiCountCustom(true);
                                    setRotiCount(Math.max(0, (rotiCount === '' ? 0 : Number(rotiCount)) - 1));
                                  }}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                                >−</button>
                                <input
                                  type="number"
                                  min={0}
                                  value={rotiCount}
                                  onChange={(e) => {
                                    setIsRotiCountCustom(true);
                                    setRotiCount(e.target.value ? parseInt(e.target.value) : '');
                                  }}
                                  className="w-12 h-8 text-center px-0 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm font-semibold text-gray-700"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsRotiCountCustom(true);
                                    setRotiCount((rotiCount === '' ? 0 : Number(rotiCount)) + 1);
                                  }}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                                >+</button>
                              </div>
                              {showRotiStandardHint && (
                                <p className="mt-2 text-[10px] leading-snug text-gray-400">
                                  Standard for {portionSize || PORTION_RG} is {defaultRotiForPortion} rotis.{' '}
                                  <button
                                    type="button"
                                    onClick={handleSetRotiToStandard}
                                    className="inline p-0 border-0 bg-transparent text-blue-600 font-semibold hover:underline cursor-pointer align-baseline"
                                  >
                                    [Set to standard]
                                  </button>
                                </p>
                              )}
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
                                          className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold border transition-all ${mwfSideMode === opt.key
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
                                          className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold border transition-all ${vegDaySideMode === opt.key
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
                                      className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-all ${item.active
                                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >1 {item.label}</button>
                                  ))}
                                </div>
                              )}

                              {customCurryPillText && (
                                <div className="mt-1 p-2.5 bg-orange-50 border border-orange-200 text-orange-600 text-xs font-semibold rounded-md flex items-center gap-2">
                                  ⚡ {customCurryPillText}
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
                        </div>

                        {/* SIDES — Salad & Dessert live outside Curries / Dal so they never
                          occupy a curry container slot or change (n/2 containers/day). */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            Sides
                          </label>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Salad</label>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSaladCount(Math.max(0, saladCount - 1))}
                                  disabled={saladCount === 0}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center transition-colors shrink-0"
                                >−</button>
                                <input
                                  type="number"
                                  min={0}
                                  value={saladCount}
                                  onChange={(e) => setSaladCount(e.target.value ? Math.max(0, parseInt(e.target.value, 10) || 0) : 0)}
                                  className="w-12 h-8 text-center px-0 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm font-semibold text-gray-700 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setSaladCount(saladCount + 1)}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                                >+</button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Dessert</label>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setDessertCount(Math.max(0, dessertCount - 1))}
                                  disabled={dessertCount === 0}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center transition-colors shrink-0"
                                >−</button>
                                <input
                                  type="number"
                                  min={0}
                                  value={dessertCount}
                                  onChange={(e) => setDessertCount(e.target.value ? Math.max(0, parseInt(e.target.value, 10) || 0) : 0)}
                                  className="w-12 h-8 text-center px-0 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-sm font-semibold text-gray-700 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setDessertCount(dessertCount + 1)}
                                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
                                >+</button>
                              </div>
                            </div>
                          </div>
                          {extraAddonNote && (
                            <div className="mt-2 p-2.5 bg-orange-50 border border-orange-200 text-orange-600 text-xs font-semibold rounded-md flex items-center gap-2">
                              ⚡ {extraAddonNote}
                            </div>
                          )}
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
                                className={`flex-1 h-9 px-3 rounded-lg text-xs font-semibold border transition-all ${discountType === opt.key
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
                  )}

                  {/* TAB 4 — AUDIT & CHANGE HISTORY */}
                  {activeDrawerTab === 'history' && (
                    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden p-5 space-y-4" data-section="edit-history">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                            Customer Audit Trail
                          </h3>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            Automated trigger records and manual staff notes.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                            {activityLogs.length} events
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsAddingLog(prev => !prev)}
                            className="px-2.5 py-1 text-xs font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#5D5FEF] hover:text-white border border-[#EFEEFC] rounded-lg transition-colors cursor-pointer"
                          >
                            {isAddingLog ? 'Cancel' : '+ Add Log'}
                          </button>
                        </div>
                      </div>

                      {/* Expandable Manual Note Card */}
                      {isAddingLog && (
                        <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {/* Type Tag Selector */}
                            <div className="flex items-center gap-1.5">
                              {(['NOTE', 'BILLING', 'OVERRIDE'] as const).map(tag => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setNewLogType(tag)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                                    newLogType === tag
                                      ? 'bg-[#5D5FEF] text-white border-[#5D5FEF]'
                                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                                  }`}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>

                            {/* Date Picker */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-gray-400">Date:</span>
                              <input
                                type="date"
                                value={newLogDate}
                                onChange={e => setNewLogDate(e.target.value)}
                                className="text-xs px-2 py-1 bg-white border border-gray-200 rounded-lg outline-none font-semibold text-gray-700"
                              />
                            </div>
                          </div>

                          {/* Text Area */}
                          <textarea
                            rows={2}
                            value={newLogSummary}
                            onChange={e => setNewLogSummary(e.target.value)}
                            placeholder="e.g. Customer requested upgrade to LG starting next week; confirmed via WhatsApp."
                            className="w-full text-xs p-2.5 bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5D5FEF] resize-none text-gray-800 placeholder-gray-400"
                          />

                          <div className="flex justify-end items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setIsAddingLog(false);
                                setNewLogSummary('');
                              }}
                              className="px-3 py-1 text-xs text-gray-500 font-semibold hover:bg-gray-200/60 rounded-lg transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isSavingLog || !newLogSummary.trim()}
                              onClick={handleCreateManualLog}
                              className="px-3.5 py-1 text-xs font-bold text-white bg-[#5D5FEF] hover:bg-[#4D4FD9] rounded-lg disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                            >
                              {isSavingLog ? 'Saving…' : 'Save Entry'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Timeline List */}
                      {isLoadingLogs ? (
                        <div className="py-12 text-center text-xs text-gray-400 font-medium">
                          Loading change history…
                        </div>
                      ) : activityLogs.length === 0 ? (
                        <div className="py-12 text-center text-xs text-gray-400 italic">
                          No logged changes recorded for this customer yet.
                        </div>
                      ) : (
                        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
                          {activityLogs.map((log) => {
                            const badgeColor =
                              log.action_type === 'BILLING'
                                ? 'text-emerald-700 bg-emerald-50'
                                : log.action_type === 'OVERRIDE'
                                ? 'text-amber-800 bg-amber-50'
                                : 'text-indigo-700 bg-indigo-50';

                            return (
                              <div key={log.id} className="relative group">
                                <div className="absolute -left-[20px] top-1.5 w-2 h-2 rounded-full bg-indigo-600 ring-4 ring-white" />
                                <div className="bg-gray-50/80 border border-gray-100 rounded-xl p-3 hover:bg-white hover:shadow-xs transition-all">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor}`}>
                                      {log.action_type}
                                    </span>
                                    <div className="flex items-center gap-1 text-[10.5px] font-semibold text-gray-400">
                                      <Clock className="w-3 h-3" />
                                      <span>
                                        {new Date(log.created_at).toLocaleString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                          hour: 'numeric',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-[12.5px] font-bold text-gray-800 leading-snug">
                                    {log.summary}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {/* SUBSCRIPTION MANAGEMENT SECTION */}
                  {selectedCustomer && !isAddingNew && (
                    <div className="space-y-2 pt-2">
                      {/* Pause/Cancel date info banner (only shown when paused/cancelled) */}
                      {((selectedCustomer.subscription_status || 'active') === 'paused' || (selectedCustomer.subscription_status || 'active') === 'cancelled') && (
                        <div className={`px-3 py-2 rounded-lg border text-[11px] font-medium ${(selectedCustomer.subscription_status || 'active') === 'cancelled'
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

                      {/* Scheduled (future) cancel/pause — active cancellation card.
                          While a schedule is pending the Pause/Cancel buttons are replaced
                          by this card so the only path forward is Undo (Delete Customer
                          Record is still available at the bottom of the sheet). */}
                      {(() => {
                        const sc = selectedCustomer;
                        const scheduledDate = sc.scheduled_cancel_date;
                        const hasScheduled =
                          sc.scheduled_status === 'cancelled' || !!scheduledDate;
                        if (!hasScheduled) return null;
                        const isScheduledPause = sc.scheduled_status === 'paused';
                        return (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 p-3 space-y-1.5">
                            <p className="text-[11.5px] font-semibold leading-snug">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> {isScheduledPause ? 'Pause' : 'Cancellation'} scheduled after{' '}
                              <strong>{scheduledDate ? formatShortLastDay(scheduledDate) : '—'}</strong> — their last tiffin day.
                            </p>
                            <p className="text-[11px] text-amber-700 leading-snug">
                              Customer will automatically transition to {isScheduledPause ? 'Paused' : 'Cancelled'} the next day.
                            </p>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => startTransition(async () => {
                                try {
                                  await clearScheduledCancellation(sc.id);
                                  setSelectedCustomer({
                                    ...sc,
                                    scheduled_cancel_date: null,
                                    scheduled_status: null,
                                    cancellation_reason: null,
                                  });
                                  showToast(`${sc.full_name} — scheduled ${isScheduledPause ? 'pause' : 'cancellation'} cleared`);
                                } catch (err) {
                                  showToast(err instanceof Error ? err.message : 'Failed to clear the scheduled cancellation', 'error');
                                }
                              })}
                              className="w-full mt-0.5 px-3 py-2 bg-white text-amber-800 border border-amber-400 rounded-lg text-[11px] font-bold hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
                            >
                              {isPending ? 'Clearing…' : <span className="flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" /> Undo Cancellation & Keep Active</span>}
                            </button>
                          </div>
                        );
                      })()}

                      {/* Action Buttons — hidden while a scheduled cancel/pause is pending */}
                      {!(selectedCustomer.scheduled_status === 'cancelled' || selectedCustomer.scheduled_cancel_date) ? (
                        <div className="grid grid-cols-2 gap-2">
                          {(selectedCustomer.subscription_status || 'active') === 'active' && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setPauseStartDate(toLocalDateKey(new Date()));
                                  setPauseEndDate('');
                                  setIsIndefinitePause(false);
                                  setShowPauseModal(true);
                                }}
                                className="h-10 px-3 flex items-center justify-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold hover:bg-amber-100 transition-colors"
                              >
                                <Pause className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
                                <span>Pause Service</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setCancelReason('');
                                  setCancelDate(toLocalDateKey(new Date()));
                                  setShowCancelModal(true);
                                }}
                                className="h-10 px-3 flex items-center justify-center gap-1.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors"
                              >
                                <Ban className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
                                <span>Cancel Service</span>
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
                                className="h-10 px-3 bg-green-50 text-green-700 border border-green-200 rounded-xl text-xs font-bold hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <Play className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
                                <span>{isPending ? 'Resuming...' : 'Resume Service'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancelReason('');
                                  setCancelDate(toLocalDateKey(new Date()));
                                  setShowCancelModal(true);
                                }}
                                className="h-10 px-3 flex items-center justify-center gap-1.5 border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-xl transition-colors"
                              >
                                <Ban className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
                                <span>Cancel Service</span>
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
                      ) : null}
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

      {/* SECTION: MODAL_CONFIRM_ACTIONS */}
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
                  <label className="block text-[11px] font-semibold text-[#A2A4B0] uppercase mb-1">Last Service Date</label>
                  <input
                    type="date"
                    value={pauseStartDate}
                    onChange={(e) => setPauseStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px]"
                  />
                  <p className="text-[10.5px] text-gray-400 mt-1 leading-snug">
                    The last tiffin day we prepare for them — pause begins the day after. Choose today to pause immediately.
                  </p>
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
                    className={`w-full px-3 py-2 border rounded-lg outline-none text-[13px] transition-all ${isIndefinitePause
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
                    try {
                      const lastServiceDate = pauseStartDate;
                      const endDate = isIndefinitePause ? null : pauseEndDate || null;
                      const isScheduledPause = lastServiceDate > todayKey;
                      await pauseCustomer(target.id, lastServiceDate, endDate);
                      setShowPauseModal(false);
                      setConfirmCustomer(null);
                      if (selectedCustomer?.id === target.id) {
                        setSelectedCustomer(
                          isScheduledPause
                            ? {
                              // Stays active through the last tiffin day; pause begins the day after.
                              ...selectedCustomer,
                              subscription_status: 'active',
                              pause_start_date: null,
                              pause_end_date: endDate,
                              scheduled_cancel_date: lastServiceDate,
                              scheduled_status: 'paused',
                            }
                            : {
                              ...selectedCustomer,
                              subscription_status: 'paused',
                              pause_start_date: lastServiceDate,
                              pause_end_date: endDate,
                              scheduled_cancel_date: null,
                              scheduled_status: null,
                            }
                        );
                        closePanelGracefully();
                      }
                      showToast(
                        isScheduledPause
                          ? `${target.full_name} — pause scheduled after ${formatShortLastDay(lastServiceDate)}`
                          : `${target.full_name} paused`
                      );
                    } catch (err) {
                      // Surfaces migration/schema errors (e.g. missing scheduled_* columns) inline
                      // instead of throwing past the transition and crashing the page.
                      showToast(err instanceof Error ? err.message : 'Failed to pause customer', 'error');
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
                  Last Service Date
                </label>
                <input
                  type="date"
                  value={cancelDate}
                  onChange={(e) => setCancelDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg outline-none focus:border-[#5D5FEF] text-[13px] text-slate-700 bg-white mb-1"
                />
                <p className="text-[10.5px] text-gray-400 mb-3 leading-snug">
                  Today or earlier cancels immediately. Pick a future date to schedule their final tiffin day.
                </p>
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
                    try {
                      // Use the picked date at local midnight; fall back to "now" when empty.
                      const cancelledAt = cancelDate
                        ? new Date(`${cancelDate}T00:00:00`).toISOString()
                        : new Date().toISOString();
                      const isScheduledCancel = !!cancelDate && cancelDate > todayKey;
                      await cancelCustomer(target.id, cancelReason.trim() || null, cancelledAt);
                      setShowCancelModal(false);
                      setConfirmCustomer(null);
                      if (selectedCustomer?.id === target.id) {
                        setSelectedCustomer(
                          isScheduledCancel
                            ? {
                              // Stays active through the last tiffin day; cancelled after it.
                              ...selectedCustomer,
                              cancellation_reason: cancelReason.trim() || null,
                              cancelled_at: null,
                              scheduled_cancel_date: cancelDate,
                              scheduled_status: 'cancelled',
                            }
                            : {
                              ...selectedCustomer,
                              subscription_status: 'cancelled',
                              cancellation_reason: cancelReason.trim() || null,
                              cancelled_at: cancelledAt,
                              scheduled_cancel_date: null,
                              scheduled_status: null,
                            }
                        );
                        closePanelGracefully();
                      }
                      showToast(
                        isScheduledCancel
                          ? `${target.full_name} — cancellation scheduled after ${formatShortLastDay(cancelDate)}`
                          : `${target.full_name} cancelled`
                      );
                    } catch (err) {
                      // Surfaces migration/schema errors (e.g. missing scheduled_* columns) inline
                      // instead of throwing past the transition and crashing the page.
                      showToast(err instanceof Error ? err.message : 'Failed to cancel customer', 'error');
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

      {/* 💳 LOG PAYMENT / RENEW CYCLE MODAL */}
      {showRenewModal &&
        confirmCustomer &&
        (() => {
          const used = confirmCustomer.used_credits || 0;
          const total = confirmCustomer.total_tiffin_credits || 20;
          const graceUsed = Math.max(0, used - total);
          const remaining = Math.max(0, 20 - graceUsed);
          return (
            <>
              <div
                className="fixed inset-0 z-50 bg-black/30"
                onClick={() => { setShowRenewModal(false); setConfirmCustomer(null); }}
              />
              <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
                <div className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[400px] pointer-events-auto p-6" onClick={e => e.stopPropagation()}>
                  <h3 className="text-[15px] font-bold text-[#11142D] mb-1">💳 Log Payment / Renew Cycle</h3>
                  <p className="text-[12px] text-gray-500 mb-5">
                    {graceUsed > 0 ? (
                      <>
                        Customer consumed <strong>{graceUsed} grace tiffin{graceUsed > 1 ? 's' : ''}</strong> during
                        this cycle. Renewing a <strong>Monthly (20)</strong> plan will start them with{' '}
                        <strong>{remaining} remaining deliver{remaining === 1 ? 'y' : 'ies'}</strong>.
                      </>
                    ) : (
                      <>Reset delivery ledger to <strong>0/20 delivered</strong> for the next cycle.</>
                    )}
                  </p>
                  <div className="flex items-center justify-end space-x-2 mt-6">
                    <button
                      type="button"
                      onClick={() => { setShowRenewModal(false); setConfirmCustomer(null); }}
                      className="px-4 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={confirmRenewCycle}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50"
                    >
                      {isPending ? 'Renewing…' : 'Confirm & Renew'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

      {/* ⭐ UPGRADE PLAN MODAL */}
      {showUpgradeModal &&
        confirmCustomer &&
        (() => {
          const currentTier = confirmCustomer.plan_tier || 'monthly';
          const options =
            currentTier === 'trial'
              ? PLAN_OPTIONS.filter(o => o.key === 'weekly' || o.key === 'monthly')
              : PLAN_OPTIONS.filter(o => o.key === 'monthly');
          return (
            <>
              <div
                className="fixed inset-0 z-50 bg-black/30"
                onClick={() => { setShowUpgradeModal(false); setConfirmCustomer(null); }}
              />
              <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
                <div className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[400px] pointer-events-auto p-6" onClick={e => e.stopPropagation()}>
                  <h3 className="text-[15px] font-bold text-indigo-700 mb-1">⭐ Upgrade Plan</h3>
                  <p className="text-[12px] text-gray-500 mb-5">
                    Choose a new plan for <strong>{confirmCustomer.full_name}</strong>. Address and dietary
                    preferences are preserved, and credits top up on top of their current usage.
                  </p>
                  <div className="space-y-2">
                    {options.map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={isPending}
                        onClick={opt.key === 'weekly' ? confirmUpgradeToWeekly : confirmUpgradeToMonthly}
                        className="w-full px-4 py-2.5 rounded-lg text-[13px] font-semibold border bg-indigo-50/60 border-indigo-200 text-indigo-700 hover:bg-indigo-100 flex items-center justify-between disabled:opacity-50 transition-colors"
                      >
                        <span>Upgrade to {opt.label} ({opt.credits})</span>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-end space-x-2 mt-6">
                    <button
                      type="button"
                      onClick={() => { setShowUpgradeModal(false); setConfirmCustomer(null); }}
                      className="px-4 py-2 border border-[#E0E0E0] text-[#7A7C87] font-semibold rounded-lg text-xs hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

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
          className={`fixed bottom-5 right-5 z-[70] px-4 py-2.5 rounded-lg text-white text-[13px] font-semibold shadow-lg flex items-center gap-2 transition-all ${toast.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          role="status"
        >
          {toast.kind === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

    </div>
  );
}