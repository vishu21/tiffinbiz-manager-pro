// Shared pickup-day resolution used across the Customers drawer, Prep Kitchen Packing
// Manifest, and the Deliveries Daily Dispatch checklist.
//
// Model:
//   - Modern records store per-day pickup flags in `pickup_days` (array of full day
//     names, e.g. ['Tuesday', 'Wednesday']).
//   - Legacy pickup records predate the column and are recognised by an `is_pickup`
//     boolean flag and/or an address/name containing "PICKUP" (the old "Kitchen Pickup"
//     marker). When a legacy record has no `pickup_days`, every active schedule day is
//     treated as pickup (backward compatibility).

export const FULL_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

// Canonicalizes a raw day token (full name, 3-letter abbreviation, mixed case) to its
// full capitalized day name, or null when it doesn't match a real day.
const canonicalizeDayToken = (raw: unknown): string | null => {
  const token = String(raw ?? '').trim().toLowerCase();
  if (!token) return null;
  // A 3-letter token ('tue') must resolve to its OWN day ('Tuesday'), not to the
  // first day in the list. Full day names match exactly; shorter tokens match the
  // day whose name starts with them.
  const index = FULL_DAY_NAMES.findIndex(day => {
    const lower = day.toLowerCase();
    return lower === token || (token.length === 3 && lower.startsWith(token));
  });
  return index === -1 ? null : FULL_DAY_NAMES[index];
};

// Expands "Monday to Friday"-style ranges inside a schedule string into a comma list.
const expandDayRanges = (input: string): string => {
  return input.replace(
    /\b([A-Za-z]{3,9})\s+to\s+([A-Za-z]{3,9})\b/gi,
    (_match, fromRaw: string, toRaw: string) => {
      const from = canonicalizeDayToken(fromRaw);
      const to = canonicalizeDayToken(toRaw);
      if (!from || !to) return `${fromRaw} to ${toRaw}`;
      const start = Math.min(FULL_DAY_NAMES.indexOf(from), FULL_DAY_NAMES.indexOf(to));
      const end = Math.max(FULL_DAY_NAMES.indexOf(from), FULL_DAY_NAMES.indexOf(to));
      return FULL_DAY_NAMES.slice(start, end + 1).join(', ');
    }
  );
};

// Normalizes a stored comma/space separated delivery_schedule into full day names.
// Understands the formats this app writes: 'Mon,Tue,...', full names, ranges like
// 'Monday to Friday' (optionally with a trailing ', Saturday'), and [EXCEPT: ...] notes.
export const parseActiveScheduleDays = (
  schedule: string | null | undefined
): string[] => {
  if (!schedule) return [];
  let text = String(schedule).trim();
  if (!text || text === '—') return [];

  const exceptMatch = text.match(/\[EXCEPT:\s*(.*?)\]/i);
  const excluded = new Set<string>();
  if (exceptMatch) {
    exceptMatch[1]
      .split(',')
      .map(token => canonicalizeDayToken(token))
      .filter((day): day is string => day !== null)
      .forEach(day => excluded.add(day));
    text = text.replace(/\[EXCEPT:.*?\]/gi, '');
  }

  const expanded = expandDayRanges(text);
  const days: string[] = [];
  expanded
    .split(/[\s,]+/)
    .map(token => canonicalizeDayToken(token))
    .filter((day): day is string => day !== null && !excluded.has(day))
    .forEach(day => {
      if (!days.includes(day)) days.push(day);
    });
  return days;
};

// Normalizes a raw pickup_days value (full day names or abbreviations) into a deduped
// array of full day names, preserving the caller's order.
export const normalizePickupDays = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const days: string[] = [];
  value.forEach(raw => {
    const day = canonicalizeDayToken(raw);
    if (day && !days.includes(day)) days.push(day);
  });
  return days;
};

export type PickupCustomerFields = {
  full_name?: string | null;
  delivery_address?: string | null;
  delivery_schedule?: string | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | string | null;
};

// True when the customer record predates per-day pickup_days and was created under the
// old all-days Kitchen Pickup flow (is_pickup flag and/or a PICKUP marker in the text).
export const isLegacyPickupCustomer = (customer: PickupCustomerFields): boolean => {
  if (customer.is_pickup === true) return true;
  const markerText = `${customer.delivery_address ?? ''} ${customer.full_name ?? ''}`
    .toUpperCase();
  return markerText.includes('PICKUP');
};

// Effective pickup day names for a customer:
//   - modern: stored pickup_days (normalized)
//   - legacy: is_pickup true (or PICKUP marker) with empty pickup_days → every active
//     schedule day counts as pickup (backward compatibility).
export const pickupDaysForCustomer = (customer: PickupCustomerFields): string[] => {
  const stored = normalizePickupDays(customer.pickup_days);
  if (stored.length > 0) return stored;
  if (isLegacyPickupCustomer(customer)) {
    return parseActiveScheduleDays(customer.delivery_schedule);
  }
  return [];
};

// True when `dayName` is a pickup day for the customer. Callers should only evaluate
// this for days the customer is actually scheduled on.
export const isPickupOnDay = (
  customer: PickupCustomerFields,
  dayName: string | null | undefined
): boolean => {
  if (!dayName) return false;
  return pickupDaysForCustomer(customer).includes(dayName);
};

// True when the customer is pickup on every scheduled day (i.e. they never need a
// driver — used by the customers list to show the Kitchen Pickup badge).
export const isPurePickupCustomer = (customer: PickupCustomerFields): boolean => {
  const scheduled = parseActiveScheduleDays(customer.delivery_schedule);
  if (scheduled.length === 0) return false;
  const pickup = pickupDaysForCustomer(customer);
  if (pickup.length === 0) return false;
  return scheduled.every(day => pickup.includes(day));
};
