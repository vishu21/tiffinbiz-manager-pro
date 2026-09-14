'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { normalizePickupDays } from '@/app/utils/customerPickup';

// Canonical default delivery plan: Mon–Fri as a comma-separated day list.
const DEFAULT_DELIVERY_SCHEDULE = 'Mon,Tue,Wed,Thu,Fri';

// Plan tier → tiffin credits included per cycle.
const TIER_CREDITS: Record<string, number> = {
  trial: 1,
  weekly: 5,
  monthly: 20,
};

type CustomerPayload = {
  full_name: string;
  phone_number: string | null;
  delivery_address: string;
  dietary_notes: string | null;
  meal_type: string | null;
  portion_size: string | null;
  roti_count: number | null;
  // Optional: the pronthi_count column landed in migration 00006 and may not exist on
  // older schemas yet, so callers can omit it (and actions.ts strips it when Supabase
  // reports PGRST204 / a missing column).
  pronthi_count?: number | null;
  // Optional: is_pickup + pickup_days landed in migration 00011 and may not exist on
  // older schemas yet, so callers can omit them (and actions.ts strips them when
  // Supabase reports PGRST204 / a missing column). pickup_days stores full day names,
  // e.g. ['Tuesday', 'Wednesday'].
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  rice_count: string | null;
  delivery_schedule: string | null;
  delivery_instructions: string | null;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  discount_note?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
  plan_tier?: 'trial' | 'weekly' | 'monthly' | null;
  total_tiffin_credits?: number | null;
  start_date?: string | null;
  subscription_status?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  // Optional: scheduled (future) cancel/pause support landed in migration 00014 and may not
  // exist on older schemas yet, so callers can omit them (and actions.ts strips/skips them
  // when Supabase reports the column is missing). scheduled_cancel_date is the customer's
  // "Last Service Date"; scheduled_status is applied automatically once that date has passed.
  scheduled_cancel_date?: string | null;
  scheduled_status?: 'cancelled' | 'paused' | null;
  // Optional: referred_by (free-text referral source — a person's name or a channel such
  // as "Instagram" / "Flyer") landed in migration 00012 and may not exist on older schemas
  // yet, so callers can omit it (and actions.ts strips it when Supabase reports PGRST204 /
  // a missing column).
  referred_by?: string | null;
};

// Normalizes optional metadata fields before hitting Supabase so empty/undefined values are
// handled gracefully:
//  - `curry_config` empty/whitespace → `null`
//  - any key explicitly `undefined` → removed from the payload (Supabase leaves it untouched)
const normalizeCustomerPayload = (payload: CustomerPayload): CustomerPayload => {
  const clean: CustomerPayload = { ...payload };

  // Fall back to the standard Mon–Fri weekday plan whenever the schedule is
  // undefined, null, empty, or whitespace-only.
  const schedule = clean.delivery_schedule?.trim();
  clean.delivery_schedule = schedule || DEFAULT_DELIVERY_SCHEDULE;

  // Phone is optional: trim it and store null when blank ("" → null).
  if (clean.phone_number === '' || clean.phone_number === null) {
    clean.phone_number = null;
  } else if (typeof clean.phone_number === 'string') {
    clean.phone_number = clean.phone_number.trim() || null;
  }

  // Pronthi is an integer bread count: coerce gracefully before sending.
  const pronthiNum = Number(clean.pronthi_count);
  clean.pronthi_count = Number.isFinite(pronthiNum)
    ? Math.max(0, Math.trunc(pronthiNum))
    : 0;

  // Pickup flags are canonicalized before hitting Supabase: pickup_days keeps only
  // recognized full day names, and is_pickup falls back to "any pickup day" when the
  // caller did not provide an explicit boolean.
  if (clean.pickup_days !== undefined && clean.pickup_days !== null) {
    clean.pickup_days = normalizePickupDays(clean.pickup_days);
  }
  if (clean.is_pickup === undefined || clean.is_pickup === null) {
    clean.is_pickup = (clean.pickup_days?.length ?? 0) > 0;
  }

  // Defensive fallback: pickup-only records legitimately have no destination address, but
  // some `customers` schemas enforce NOT NULL (or a CHECK) on delivery_address. Persist the
  // legacy "Kitchen Pickup" marker instead of an empty string — older views also use that
  // marker to recognise pickup records before migration 00011 runs.
  if (
    clean.is_pickup &&
    typeof clean.delivery_address === 'string' &&
    clean.delivery_address.trim() === ''
  ) {
    clean.delivery_address = 'Kitchen Pickup';
  }

  if (clean.curry_config !== undefined && clean.curry_config !== null) {
    const trimmed = clean.curry_config.trim();
    clean.curry_config = trimmed === '' ? null : trimmed;
  }

  // Plan tier + credit ledger values (default to Monthly / 20 when omitted).
  if (clean.plan_tier !== undefined && clean.plan_tier !== null) {
    const tier = clean.plan_tier;
    clean.plan_tier = tier === 'trial' || tier === 'weekly' || tier === 'monthly' ? tier : 'monthly';
  } else if (clean.plan_tier === undefined) {
    clean.plan_tier = 'monthly';
  }
  if (clean.total_tiffin_credits !== undefined && clean.total_tiffin_credits !== null) {
    const credits = Number(clean.total_tiffin_credits);
    clean.total_tiffin_credits = Number.isFinite(credits)
      ? Math.max(1, Math.trunc(credits))
      : TIER_CREDITS[clean.plan_tier || 'monthly'];
  } else if (clean.total_tiffin_credits === undefined || clean.total_tiffin_credits === null) {
    clean.total_tiffin_credits = TIER_CREDITS[clean.plan_tier || 'monthly'];
  }
  // Optional subscription start date — blank → null.
  if (clean.start_date !== undefined) {
    const start = clean.start_date?.trim();
    clean.start_date = start ? start : null;
  }

  // Referral source is optional free text — blank/whitespace → null.
  if (clean.referred_by !== undefined) {
    const referral = clean.referred_by?.trim();
    clean.referred_by = referral ? referral : null;
  }

  (Object.keys(clean) as (keyof CustomerPayload)[]).forEach(key => {
    if (clean[key] === undefined) delete clean[key];
  });

  return clean;
};

// Removes pronthi_count so a profile update can succeed before the migration runs.
const stripPronthiCount = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.pronthi_count;
  return copy;
};

// Shared helper: does a Supabase/Postgres error mention any of the given column names?
// Covers PostgREST PGRST204 ("schema cache") plus a direct Postgres 42703 undefined_column
// error so the stripping retries below fire in both cases.
const isMissingColumnError = (error: unknown, names: string[]): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase();
  const wanted = names.map(name => name.toLowerCase());
  if (e.code === 'PGRST204' || e.code === '42703') {
    return wanted.some(name => text.includes(name));
  }
  return (
    typeof e.message === 'string' &&
    e.message.toLowerCase().includes('does not exist') &&
    wanted.some(name => text.includes(name))
  );
};

// True when Supabase rejected the payload because the pronthi_count column is absent.
const isPronthiColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['pronthi_count']);

// Removes is_pickup / pickup_days so a save can succeed before migration 00011 runs.
const stripPickupColumns = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.is_pickup;
  delete copy.pickup_days;
  return copy;
};

// True when Supabase rejected the payload because the is_pickup / pickup_days column(s)
// are absent (PGRST204 "could not find the column ... in the schema cache" or a direct
// Postgres 42703 undefined_column error).
const isPickupColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['pickup_days', 'is_pickup']);

// Removes referred_by so a save can succeed before migration 00012 runs.
const stripReferredByColumn = (payload: CustomerPayload): CustomerPayload => {
  const copy: CustomerPayload = { ...payload };
  delete copy.referred_by;
  return copy;
};

// True when Supabase rejected the payload because the referred_by column is absent.
const isReferredByColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, ['referred_by']);

// ── Scheduled (future) cancel/pause support ────────────────────────────────────────────
// Columns landed in migration 00014_add_scheduled_status.sql:
//   scheduled_cancel_date DATE → the customer's last service (tiffin) day
//   scheduled_status TEXT      → 'cancelled' | 'paused', applied once that day has passed
// While the date is in the future the customer stays subscription_status = 'active' and
// keeps appearing on the prep manifest (with a LAST DAY badge on the date itself).
const SCHEDULED_COLUMNS = ['scheduled_cancel_date', 'scheduled_status'];
const SCHEDULE_MIGRATION_HINT =
  'Scheduling a future cancel/pause requires supabase/migrations/00014_add_scheduled_status.sql. Please run the migration and try again.';

const isScheduledColumnMissing = (error: unknown): boolean =>
  isMissingColumnError(error, SCHEDULED_COLUMNS);

// Removes the scheduled columns so an immediate write still succeeds on an old schema.
const stripScheduledColumns = (payload: Record<string, unknown>): Record<string, unknown> => {
  const copy = { ...payload };
  delete copy.scheduled_cancel_date;
  delete copy.scheduled_status;
  return copy;
};

// ── Scheduled-column schema probe ─────────────────────────────────────────────────────
// Dry-run SELECT of a single column with LIMIT 1. PostgREST resolves the requested
// column list before returning any rows, so a genuinely missing column (Postgres 42703)
// or a STALE PostgREST schema cache (PGRST204) surfaces as an error, while an empty
// customers table still succeeds. No rows are transferred.
const probeScheduledColumn = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: string
): Promise<boolean> => {
  const { error } = await supabase.from('customers').select(column).limit(1);
  if (!error) return true;
  // Any non-missing error (RLS, network, auth) is NOT treated as an absent column so a
  // transient failure can never be mistaken for an unapplied migration.
  return !isMissingColumnError(error, [column]);
};

// Probes BOTH scheduled columns and returns exactly which ones are present/missing.
// The result is always logged so an operator can see whether
// supabase/migrations/00014_add_scheduled_status.sql still needs to be run in Supabase.
const probeScheduledColumns = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: string
): Promise<{ present: string[]; missing: string[] }> => {
  const present: string[] = [];
  const missing: string[] = [];
  for (const column of SCHEDULED_COLUMNS) {
    if (await probeScheduledColumn(supabase, column)) present.push(column);
    else missing.push(column);
  }
  console.info(
    `[${context}] customers scheduled columns — present: [${present.join(', ') || 'none'}]` +
      ` | missing: [${missing.join(', ') || 'none'}]`
  );
  return { present, missing };
};

// Local server date as YYYY-MM-DD (Postgres DATE columns round-trip in this shape).
const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const serverDateKey = (): string => toDateKey(new Date());

// Shared customers write used by pause/cancel: future-dated (scheduled) writes require the
// migration 00014 columns; immediate writes degrade gracefully by stripping those columns
// when the target database hasn't been migrated yet.
const runCustomerStatusUpdate = async (
  id: string,
  payload: Record<string, unknown>,
  options: { requiresScheduledColumns: boolean; context: string }
) => {
  const supabase = await createClient();
  let current = { ...payload };

  // When a scheduled (future-dated) write needs the migration 00014 columns, probe them
  // up-front so the server log states exactly which columns are present/missing.
  if (options.requiresScheduledColumns) {
    let probe = await probeScheduledColumns(supabase, options.context);

    // The columns can be genuinely present while PostgREST still serves a STALE schema
    // cache (migration 00014 issues NOTIFY pgrst, 'reload schema' but PostgREST applies
    // it asynchronously). Ask for ONE explicit reload and re-probe before giving up.
    if (probe.missing.length > 0) {
      const { error: reloadError } = await supabase.rpc('notify_pgrst_reload');
      if (!reloadError) {
        await new Promise(resolve => setTimeout(resolve, 400));
        probe = await probeScheduledColumns(supabase, options.context);
      }
    }

    if (probe.missing.length > 0) {
      console.error(
        `[${options.context}] customers is missing scheduled column(s): [${probe.missing.join(', ')}]. ` +
          'Run supabase/migrations/00014_add_scheduled_status.sql in the Supabase SQL Editor.'
      );
      throw new Error(SCHEDULE_MIGRATION_HINT);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('customers').update(current).eq('id', id);
    if (!error) return;
    if (isScheduledColumnMissing(error)) {
      if (options.requiresScheduledColumns) {
        console.error(`[${options.context}] Scheduled columns are missing on the database.`, error);
        throw new Error(SCHEDULE_MIGRATION_HINT);
      }
      console.warn(
        `[${options.context}] Database schema missing scheduled_cancel_date/scheduled_status — retrying without them.`
      );
      current = stripScheduledColumns(current);
      continue;
    }
    console.error(`[${options.context}] Database update error:`, error);
    throw new Error(error.message);
  }
  throw new Error(`${options.context} failed after stripping optional schema columns.`);
};

// ── Database error helpers ────────────────────────────────────────────────────────────
// Supabase/PostgREST errors carry { code, message, details, hint }; we surface every field
// so a rejected insert/update shows the exact failing constraint or column.
type DatabaseErrorShape = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const readDatabaseError = (error: unknown): DatabaseErrorShape => {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const e = error as DatabaseErrorShape;
  return {
    code: e.code ?? null,
    message: e.message ?? String(error),
    details: e.details ?? null,
    hint: e.hint ?? null,
  };
};

// Structured console output for debugging a failed Supabase write.
const logDatabaseError = (context: string, error: unknown) => {
  const e = readDatabaseError(error);
  console.error(`[${context}] Supabase rejected the database write.`, {
    code: e.code,
    message: e.message,
    details: e.details,
    hint: e.hint,
    raw: error,
  });
};

// Single-line message that keeps code/hint/details alongside the Postgres text so the
// client alert/toast shows exactly why the write failed.
const formatDatabaseError = (error: unknown): string => {
  const e = readDatabaseError(error);
  const parts = [
    e.message || String(error),
    e.details ? `details: ${e.details}` : '',
    e.hint ? `hint: ${e.hint}` : '',
    e.code ? `code: ${e.code}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
};

// ── Duplicate-phone handling ───────────────────────────────────────────────────────────
// Returns true when Postgres rejected the write with a unique-violation (SQLSTATE 23505)
// on the customers.phone_number column. Migration 00013 drops customers_phone_number_key
// so roommates/family members can share a contact number, but this guard stays so a DB
// that hasn't been migrated yet surfaces an actionable message instead of raw constraint
// internals.
const isDuplicatePhoneError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string | null; message?: string | null; details?: string | null };
  if (e.code !== '23505') return false;
  const text = [e.message, e.details].filter(Boolean).join(' ').toLowerCase();
  return text.includes('phone_number') || text.includes('customers_phone_number_key');
};

// Friendly message used when a duplicate phone write slips through; the server log still
// receives the full structured error via logDatabaseError before this throw.
const DUPLICATE_PHONE_MESSAGE =
  'A customer with this phone number already exists. Please modify the phone number or adjust database constraints.';

const formatCustomerWriteError = (error: unknown): string =>
  isDuplicatePhoneError(error) ? DUPLICATE_PHONE_MESSAGE : formatDatabaseError(error);

// 1. CREATE CUSTOMER
export async function createCustomer(payload: CustomerPayload) {
  const supabase = await createClient();
  const normalized = normalizeCustomerPayload(payload);

  // Retry loop strips optional columns (pronthi_count / pickup columns) that may not
  // exist yet when a migration hasn't been applied to the target database.
  const attemptInsert = async (row: CustomerPayload): Promise<Record<string, unknown> | null> => {
    let current = { ...row };
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabase
        .from('customers')
        .insert([current])
        .select('*')
        .single();
      if (!error) return data;
      if (isPronthiColumnMissing(error)) {
        console.warn('Database schema missing pronthi_count, retrying without pronthi_count...');
        current = stripPronthiCount(current);
        continue;
      }
      if (isPickupColumnMissing(error)) {
        console.warn(
          'Database schema is missing is_pickup/pickup_days — retrying without them. ' +
            'Run supabase/migrations/00011_add_pickup_days.sql to persist per-day pickup data.'
        );
        current = stripPickupColumns(current);
        continue;
      }
      if (isReferredByColumnMissing(error)) {
        console.warn(
          'Database schema is missing referred_by — retrying without it. ' +
            'Run supabase/migrations/00012_add_referred_by.sql to persist referral sources.'
        );
        current = stripReferredByColumn(current);
        continue;
      }
      // Surface every field of the underlying Postgres error (code / message / details /
      // hint) in the server log AND in the error rethrown to the client alert/toast.
      logDatabaseError('createCustomer.insert', error);
      throw new Error(formatCustomerWriteError(error));
    }
    throw new Error('Customer insert failed after stripping optional schema columns.');
  };

  // Returns the created row so the client can prepend it at index 0 and highlight it.
  const created = (await attemptInsert(normalized)) ?? null;
  revalidatePath('/admin/customers');
  revalidatePath('/prep');
  return created;
}

// 2. UPDATE CUSTOMER
// Returns the refreshed Supabase row (or null) so callers can patch local UI state
// immediately instead of racing router.refresh(). pickup_days is persisted as-is on the
// normal path; it is only stripped on a retry when the DB schema predates migration 00011.
export async function updateCustomer(
  id: string,
  payload: CustomerPayload
): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const normalized = normalizeCustomerPayload(payload);

  let current = { ...normalized };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase
      .from('customers')
      .update(current)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (!error) {
      // Invalidate the customers table AND the Prep manifest (both consume pickup flags).
      revalidatePath('/admin/customers');
      revalidatePath('/prep');
      // Return the refreshed row so the drawer/list reflect the save immediately.
      return data;
    }
    if (isPronthiColumnMissing(error)) {
      console.warn('Database schema missing pronthi_count, retrying without pronthi_count...');
      current = stripPronthiCount(current);
      continue;
    }
    if (isPickupColumnMissing(error)) {
      console.warn(
        'Database schema is missing is_pickup/pickup_days — retrying without them. ' +
          'Run supabase/migrations/00011_add_pickup_days.sql to persist per-day pickup data.'
      );
      current = stripPickupColumns(current);
      continue;
    }
    if (isReferredByColumnMissing(error)) {
      console.warn(
        'Database schema is missing referred_by — retrying without it. ' +
          'Run supabase/migrations/00012_add_referred_by.sql to persist referral sources.'
      );
      current = stripReferredByColumn(current);
      continue;
    }
    // Surface every field of the underlying Postgres error (code / message / details /
    // hint) in the server log AND in the error rethrown to the client alert/toast.
    logDatabaseError('updateCustomer.update', error);
    throw new Error(formatCustomerWriteError(error));
  }
  throw new Error('Customer update failed after stripping optional schema columns.');
}

// 3. DELETE CUSTOMER
export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
  revalidatePath('/admin/customers');
}

// 4. PAUSE CUSTOMER SERVICE
// lastServiceDate = the customer's last tiffin day (YYYY-MM-DD).
//   • Today or earlier → pause immediately.
//   • Future date → stays active through that date (the prep manifest still shows the
//     customer and marks it LAST TIFFIN), then pauses automatically the following day via
//     applyScheduledStatusTransitions.
export async function pauseCustomer(id: string, lastServiceDate: string, endDate: string | null) {
  const effectiveDate =
    (lastServiceDate || serverDateKey()).trim().slice(0, 10) || serverDateKey();
  const isScheduled = effectiveDate > serverDateKey();

  await runCustomerStatusUpdate(
    id,
    isScheduled
      ? {
          // Status stays active; only the schedule + optional resume window are recorded.
          pause_start_date: null,
          pause_end_date: endDate,
          scheduled_cancel_date: effectiveDate,
          scheduled_status: 'paused',
        }
      : {
          subscription_status: 'paused',
          pause_start_date: effectiveDate,
          pause_end_date: endDate,
          scheduled_cancel_date: null,
          scheduled_status: null,
        },
    { context: 'pauseCustomer', requiresScheduledColumns: isScheduled }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 5. CANCEL CUSTOMER SERVICE
// cancelledAt is the requested effective time; its date part is the "Last Service Date".
//   • Today or earlier → cancel immediately.
//   • Future date → stays active through that date (LAST TIFFIN on the manifest), then
//     cancels automatically the following day via applyScheduledStatusTransitions.
export async function cancelCustomer(id: string, reason: string | null, cancelledAt?: string | null) {
  const effective = cancelledAt && cancelledAt.trim() ? cancelledAt : new Date().toISOString();
  const effectiveDate = effective.slice(0, 10);
  const isScheduled = effectiveDate > serverDateKey();

  await runCustomerStatusUpdate(
    id,
    isScheduled
      ? {
          // Status stays active; keep the reason so it is shown once the cancel applies.
          cancellation_reason: reason,
          cancelled_at: null,
          scheduled_cancel_date: effectiveDate,
          scheduled_status: 'cancelled',
        }
      : {
          subscription_status: 'cancelled',
          cancellation_reason: reason,
          cancelled_at: effective,
          scheduled_cancel_date: null,
          scheduled_status: null,
        },
    { context: 'cancelCustomer', requiresScheduledColumns: isScheduled }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 5b. APPLY DUE SCHEDULED STATUS CHANGES (idempotent — no cron required)
// Flips every customer whose scheduled_cancel_date has already passed to their scheduled
// status ('cancelled' | 'paused') and clears the schedule columns. Called when the prep
// manifest and the customers table load so the kitchen always sees current statuses.
export async function applyScheduledStatusTransitions(): Promise<number> {
  const supabase = await createClient();
  const today = serverDateKey();

  const { data, error } = await supabase
    .from('customers')
    .select('id, scheduled_cancel_date, scheduled_status, pause_end_date')
    .not('scheduled_status', 'is', null)
    .lt('scheduled_cancel_date', today);

  if (error) {
    if (isScheduledColumnMissing(error)) {
      console.warn('[applyScheduledStatusTransitions] scheduled columns not present yet — nothing to do.');
      return 0;
    }
    console.error('Database scheduled-status transition read error:', error);
    return 0;
  }

  if (!data || data.length === 0) return 0;

  let transitioned = 0;
  for (const row of data) {
    const scheduledDate = row.scheduled_cancel_date as string | null;
    const scheduledStatus = row.scheduled_status as 'cancelled' | 'paused' | null;
    if (!scheduledDate || !scheduledStatus) continue;

    const payload: Record<string, unknown> =
      scheduledStatus === 'cancelled'
        ? {
            subscription_status: 'cancelled',
            // Legacy convenience flag: some `customers` schemas carry an is_active
            // boolean alongside subscription_status. Cleared here when present; the
            // missing-column retry below strips it when the column does not exist.
            is_active: false,
            cancelled_at: new Date(`${scheduledDate}T00:00:00`).toISOString(),
            scheduled_cancel_date: null,
            scheduled_status: null,
          }
        : {
            subscription_status: 'paused',
            pause_start_date: scheduledDate,
            pause_end_date: row.pause_end_date ?? null,
            scheduled_cancel_date: null,
            scheduled_status: null,
          };

    let updateError = (
      await supabase.from('customers').update(payload).eq('id', row.id)
    ).error;

    // is_active is optional (no migration creates it) — retry without it so a missing
    // legacy column never blocks the rollover itself.
    if (updateError && isMissingColumnError(updateError, ['is_active'])) {
      const withoutIsActive = { ...payload };
      delete withoutIsActive.is_active;
      updateError = (
        await supabase.from('customers').update(withoutIsActive).eq('id', row.id)
      ).error;
    }

    if (updateError) {
      console.error(`[applyScheduledStatusTransitions] failed to transition customer ${row.id}:`, updateError);
    } else {
      transitioned++;
    }
  }

  return transitioned;
}

// 5c. CLEAR A PENDING SCHEDULED CANCELLATION (Undo)
// Removes the pending schedule so the customer keeps being served and no automatic
// transition runs. subscription_status is intentionally untouched: scheduling never
// changed it (the customer is still active through their last tiffin day).
export async function clearScheduledCancellation(customerId: string) {
  await runCustomerStatusUpdate(
    customerId,
    {
      scheduled_cancel_date: null,
      scheduled_status: null,
      cancellation_reason: null,
    },
    { context: 'clearScheduledCancellation', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 6. RESUME CUSTOMER SERVICE
export async function resumeCustomer(id: string) {
  await runCustomerStatusUpdate(
    id,
    {
      subscription_status: 'active',
      pause_start_date: null,
      pause_end_date: null,
      scheduled_cancel_date: null,
      scheduled_status: null,
    },
    { context: 'resumeCustomer', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 6b. RENEW CREDIT CYCLE (payment + reset)
export async function renewCustomerCycle(customerId: string) {
  const supabase = await createClient();

  const { data: cust } = await supabase
    .from('customers')
    .select('used_credits, total_tiffin_credits')
    .eq('id', customerId)
    .single<{ used_credits: number | null; total_tiffin_credits: number | null }>();

  if (!cust) throw new Error('Customer not found');

  const used = cust.used_credits || 0;
  const total = cust.total_tiffin_credits || 20;
  // Grace tiffins consumed beyond the cycle (used - total).
  const graceUsed = Math.max(0, used - total);
  // Carry the grace over as the new cycle's used count, capped by the plan total.
  const nextUsed = Math.min(graceUsed, 20);

  const { error } = await supabase
    .from('customers')
    .update({
      total_tiffin_credits: 20,
      used_credits: nextUsed,
      skipped_days_count: 0,
      payment_status: 'paid',
      subscription_status: 'active',
    })
    .eq('id', customerId);

  if (error) {
    console.error('Renew cycle error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/deliveries');
}

// 6c. UPGRADE PLAN (top-up credits, keeps used credits + profile data intact)
export async function upgradeCustomerPlan(customerId: string, newTier: 'weekly' | 'monthly') {
  const supabase = await createClient();

  const credits = TIER_CREDITS[newTier];
  if (!credits) throw new Error('Unknown plan tier');

  const { data: cust } = await supabase
    .from('customers')
    .select('used_credits')
    .eq('id', customerId)
    .single<{ used_credits: number | null }>();

  if (!cust) throw new Error('Customer not found');

  const used = cust.used_credits || 0;
  const { error } = await supabase
    .from('customers')
    .update({
      plan_tier: newTier,
      total_tiffin_credits: used + credits,
      payment_status: 'paid',
      subscription_status: 'active',
    })
    .eq('id', customerId);

  if (error) {
    console.error('Upgrade plan error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/admin/deliveries');
}

// 7. UPDATE CANCELLATION DETAILS (date + reason only — never touches meal/carb prefs)
export async function updateCancellationDetails(
  id: string,
  cancelledAt: string,
  reason: string | null
) {
  const supabase = await createClient();
  const timestamp =
    cancelledAt && cancelledAt.trim() ? cancelledAt : new Date().toISOString();
  const { error } = await supabase
    .from('customers')
    .update({
      cancelled_at: timestamp,
      cancellation_reason: reason,
    })
    .eq('id', id);

  if (error) {
    console.error('Database cancellation details update error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 8. REACTIVATE CANCELLED CUSTOMER SERVICE
export async function reactivateCustomer(id: string) {
  await runCustomerStatusUpdate(
    id,
    {
      subscription_status: 'active',
      scheduled_cancel_date: null,
      scheduled_status: null,
    },
    { context: 'reactivateCustomer', requiresScheduledColumns: false }
  );

  revalidatePath('/admin/customers');
  revalidatePath('/prep');
}

// 8b. UPDATE MEAL CONFIG FROM THE PREP TAP-TO-EDIT QUICK SHEET
// Scoped partial update — only meal-config columns are ever touched, so the
// delivery schedule / plan tier / credit ledger can never be reset by this path.
export type MealConfigPayload = {
  meal_type?: 'Veg' | 'Non-veg';
  portion_size?: string;
  roti_count?: number;
  pronthi_count?: number;
  rice_count?: string;
  dietary_notes?: string | null;
  // Curry distribution sync: delivery_instructions carries the plain daily side-count
  // text the kitchen/prep parsers read, while is_custom_curry + curry_config keep the
  // structured weekly (M/W/F + T/Th) profile in sync with the /admin/customers editor.
  delivery_instructions?: string | null;
  is_custom_curry?: boolean | null;
  curry_config?: string | null;
};

export async function updateCustomerMealConfig(id: string, config: MealConfigPayload) {
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (config.meal_type !== undefined) {
    payload.meal_type = config.meal_type === 'Veg' ? 'Veg' : 'Non-veg';
  }
  if (config.portion_size !== undefined) {
    const portion = String(config.portion_size || '').trim();
    payload.portion_size = portion || 'RG';
  }
  if (config.roti_count !== undefined) {
    const roti = Number(config.roti_count);
    payload.roti_count = Number.isFinite(roti) ? Math.max(0, Math.trunc(roti)) : 0;
  }
  if (config.pronthi_count !== undefined) {
    const pronthi = Number(config.pronthi_count);
    payload.pronthi_count = Number.isFinite(pronthi) ? Math.max(0, Math.trunc(pronthi)) : 0;
  }
  if (config.rice_count !== undefined) {
    const rice = String(config.rice_count || '').trim();
    payload.rice_count = rice || 'None';
  }
  if (config.dietary_notes !== undefined) {
    const notes = String(config.dietary_notes || '').trim();
    payload.dietary_notes = notes || null;
  }
  if (config.delivery_instructions !== undefined) {
    const instructions = String(config.delivery_instructions || '').trim();
    payload.delivery_instructions = instructions || null;
  }
  if (config.is_custom_curry !== undefined) {
    payload.is_custom_curry = config.is_custom_curry === true;
  }
  if (config.curry_config !== undefined) {
    const curry = String(config.curry_config || '').trim();
    payload.curry_config = curry === '' ? null : curry;
  }

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase
    .from('customers')
    .update(payload)
    .eq('id', id);

  if (error) {
    console.error('Database meal config quick-sheet update error:', error);
    throw new Error(error.message);
  }

  revalidatePath('/prep');
  revalidatePath('/admin/customers');
}

// 9. GET CUSTOMER COUNTS BY STATUS
export async function getCustomerCounts() {
  const supabase = await createClient();
  
  const { data: all } = await supabase.from('customers').select('subscription_status');
  
  if (!all) return { total: 0, active: 0, paused: 0, cancelled: 0 };
  
  return {
    total: all.length,
    active: all.filter(c => c.subscription_status === 'active' || !c.subscription_status).length,
    paused: all.filter(c => c.subscription_status === 'paused').length,
    cancelled: all.filter(c => c.subscription_status === 'cancelled').length,
  };
}

// 10. ADDRESS SUGGESTIONS WRAPPER
export async function searchAddress(query: string) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}+Ontario&addressdetails=1&limit=5&countrycodes=ca`,
      {
        headers: {
          'User-Agent': 'TiffinManager-Internal-App/1.0 (admin@local)',
          'Accept-Language': 'en-CA,en;q=0.9'
        }
      }
    );
    if (!res.ok) throw new Error(`OSM status: ${res.status}`);
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Server-side geocoding failed securely:", error);
    return []; 
  }
}