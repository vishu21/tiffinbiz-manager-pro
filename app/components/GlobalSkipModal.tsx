'use client';

/**
 * Global Skip Modal — the ONE place a delivery skip is recorded or undone.
 *
 * Skipping used to be welded to /prep (PrepQuickEditSheet + PrepDashboardClient),
 * and /prep defaults to TOMORROW's prep date — so an on-the-road same-day skip
 * meant rewinding the date first. Worse, the old flow only nudged
 * `customers.cycle_end_date` by ±1 day, so `/prep` and `/admin/customers` could
 * disagree once real skips piled up.
 *
 * This modal calls the single centralized server action `recordCustomerSkip`
 * (app/admin/actions.ts), which writes the override rows, re-walks the cycle
 * with the shared calculator, persists the recomputed `cycle_end_date`, audits
 * the change and revalidates every surface.
 *
 * Open it from anywhere via `useGlobalSkip()` (see
 * app/components/GlobalSkipProvider.tsx) — global header, customer row, or prep
 * drawer — with or without a pre-selected customer.
 */

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { Ban, CalendarDays, Check, Loader2, Search, Undo2, X } from 'lucide-react';
import {
  getSkipCandidates,
  getSkipPreviewContext,
  recordCustomerSkip,
  pauseCustomer,
  type RecordCustomerSkipResult,
  type SkipCandidate,
  type SkipPreviewContext,
} from '@/app/admin/actions';
import {
  calculateCycleTargetLastDay,
  resolveDeliveryDayNumbers,
  toLocalDateKey,
  type CycleTargetInput,
} from '@/app/utils/subscriptionCycle';
import { useToast } from '@/app/components/ToastProvider';

export type GlobalSkipTarget = {
  id: string;
  full_name?: string | null;
  delivery_schedule?: string | null;
};

export type GlobalSkipMode = 'skip' | 'undo' | 'pause';

interface GlobalSkipModalProps {
  open: boolean;
  target: GlobalSkipTarget | null;
  initialMode?: GlobalSkipMode;
  initialDates?: string[];
  onClose: () => void;
  onSaved?: (result: RecordCustomerSkipResult) => void;
}

// ── Local date helpers (client-side so the modal renders instantly) ──

// Accepts a 'YYYY-MM-DD' value from an <input type="date"> and normalizes it.
const normalizeDateInput = (value: string): string | null => {
  const key = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
};

const formatDateLabel = (key: string): string => {
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatDateLong = (key: string): string => {
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// Whole-calendar-day difference (b − a) between two 'YYYY-MM-DD' keys.
const diffCalendarDays = (fromKey: string, toKey: string): number => {
  const from = new Date(`${fromKey}T12:00:00`).getTime();
  const to = new Date(`${toKey}T12:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
};

// Shifts a 'YYYY-MM-DD' key by N calendar days.
const shiftDateKey = (key: string, days: number): string => {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
};

// Next `count` scheduled delivery dates (delivery_schedule aware, Mon–Fri fallback).
const upcomingDeliveryDates = (
  schedule: string | null | undefined,
  count: number,
  from: Date = new Date()
): string[] => {
  const days = resolveDeliveryDayNumbers(schedule);
  const out: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (out.length < count && guard < 180) {
    if (days.has(cursor.getDay())) out.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return out;
};

// Every scheduled delivery date between two inclusive 'YYYY-MM-DD' keys.
const deliveryDatesInRange = (
  startKey: string,
  endKey: string,
  schedule: string | null | undefined
): string[] => {
  const days = resolveDeliveryDayNumbers(schedule);
  const out: string[] = [];
  const cursor = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return out;
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 800) {
    if (days.has(cursor.getDay())) out.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return out;
};

export default function GlobalSkipModal({
  open,
  target,
  initialMode,
  initialDates,
  onClose,
  onSaved,
}: GlobalSkipModalProps) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  // NOTE: the draft is seeded from props and intentionally NOT resynced by an
  // effect — the provider remounts this modal (via a `key`) on every open, so a
  // fresh `initialMode` / `initialDates` is applied without cascading renders.
  const [mode, setMode] = useState<GlobalSkipMode>(initialMode ?? 'skip');
  const [selected, setSelected] = useState<string[]>(initialDates ?? []);
  const [reason, setReason] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [query, setQuery] = useState('');
  // `null` = not fetched yet → the picker renders its loading state.
  const [candidates, setCandidates] = useState<SkipCandidate[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // When a customer is supplied by context the picker stays collapsed behind a
  // "Change" affordance; picking a candidate re-expands it on demand.
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidateList = useMemo(() => candidates ?? [], [candidates]);
  const loadingList = candidates === null;

  const pickedCandidate = pickedId ? candidateList.find(c => c.id === pickedId) ?? null : null;

  // A candidate picked in the picker wins over the context-supplied target, so
  // "Change" can fully swap the customer. Otherwise the modal's `target` stands.
  const activeTarget: GlobalSkipTarget | null = useMemo(() => {
    if (pickedCandidate) {
      return {
        id: pickedCandidate.id,
        full_name: pickedCandidate.full_name,
        delivery_schedule: pickedCandidate.delivery_schedule,
      };
    }
    return target;
  }, [target, pickedCandidate]);

  const needsPicker = changingCustomer || !target;

  // Lazily load the searchable customer list only when the picker is visible.
  // setState only happens from the async callbacks (never synchronously in the
  // effect body), keeping this clear of react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!open || !needsPicker) return;
    let cancelled = false;
    getSkipCandidates()
      .then(list => {
        if (!cancelled) setCandidates(list);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsPicker]);

  // Live cycle inputs (start date, credits, closures, existing skips) for the
  // resolved customer — these power the client-side impact preview below.
  const [previewState, setPreviewState] = useState<{
    id: string | null;
    data: SkipPreviewContext | null;
  }>({ id: null, data: null });

  const activeCustomerId = activeTarget?.id ?? null;

  useEffect(() => {
    if (!open || !activeCustomerId) return;
    let cancelled = false;
    getSkipPreviewContext(activeCustomerId)
      .then(data => {
        if (!cancelled) setPreviewState({ id: activeCustomerId, data });
      })
      .catch(() => {
        if (!cancelled) setPreviewState({ id: activeCustomerId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeCustomerId]);

  const previewContext = previewState.id === activeCustomerId ? previewState.data : null;

  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const tomorrowKey = useMemo(() => shiftDateKey(toLocalDateKey(new Date()), 1), []);

  const scheduleForDates =
    activeTarget?.delivery_schedule ?? previewContext?.deliverySchedule ?? null;
  const deliveryDates = useMemo(
    () => upcomingDeliveryDates(scheduleForDates, 14),
    [scheduleForDates]
  );

  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidateList;
    return candidateList.filter(candidate =>
      `${candidate.full_name ?? ''} ${candidate.phone_number ?? ''}`.toLowerCase().includes(q)
    );
  }, [candidateList, query]);

  const toggleDate = (key: string) => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(existing => existing !== key) : [...prev, key].sort()
    );
  };

  // Quick presets replace the selection (skip just today / just tomorrow).
  const applyPreset = (key: string) => {
    setSelected(prev => (prev.length === 1 && prev[0] === key ? [] : [key]));
    setError(null);
  };

  const clearDates = () => {
    setSelected([]);
    setError(null);
  };

  const applyRangeDates = (startVal: string, endVal: string) => {
    const startKey = normalizeDateInput(startVal);
    const endKey = normalizeDateInput(endVal);
    if (!startKey || !endKey) return;
    if (endKey < startKey) {
      setError('The range end must be on or after the start date.');
      return;
    }
    const inRange = deliveryDatesInRange(startKey, endKey, scheduleForDates);
    if (inRange.length === 0) {
      setError('No scheduled delivery days fall inside that range.');
      return;
    }
    setSelected(prev => Array.from(new Set([...prev, ...inRange])).sort());
    setError(null);
  };

  const addRange = () => {
    applyRangeDates(rangeStart, rangeEnd);
  };

  // Live impact preview — walks the cycle twice (before / after the skip) with
  // the SHARED client calculator, so the numbers match the server action exactly.
  const preview = useMemo(() => {
    if (!previewContext || selected.length === 0) return null;

    const deliveryDaySet = resolveDeliveryDayNumbers(previewContext.deliverySchedule);
    const closureSet = new Set(previewContext.closureDates);
    const baseSkips = new Set(previewContext.customerSkips);

    const baseInput: CycleTargetInput = {
      startDate: previewContext.startDate,
      totalMeals: previewContext.totalMeals,
      deliveryDays: deliveryDaySet,
      closureDates: closureSet,
      customerSkips: baseSkips,
    };

    const currentEnd =
      calculateCycleTargetLastDay(baseInput)?.dateKey ?? previewContext.cycleEndDate ?? null;

    // Only scheduled, non-closure dates actually consume a delivery slot.
    const selectedDeliveryDays = selected.filter(key => {
      const date = new Date(`${key}T12:00:00`);
      if (Number.isNaN(date.getTime())) return false;
      return deliveryDaySet.has(date.getDay()) && !closureSet.has(key);
    });

    const projectedSkips = new Set(baseSkips);
    if (mode === 'skip') selectedDeliveryDays.forEach(key => projectedSkips.add(key));
    else selected.forEach(key => projectedSkips.delete(key));

    const projectedEnd =
      calculateCycleTargetLastDay({ ...baseInput, customerSkips: projectedSkips })?.dateKey ?? null;

    const extraDays =
      currentEnd && projectedEnd ? diffCalendarDays(currentEnd, projectedEnd) : 0;

    return { currentEnd, projectedEnd, extraDays, deliveryDays: selectedDeliveryDays.length };
  }, [previewContext, selected, mode]);

  const handleSave = () => {
    setError(null);
    if (!activeTarget) {
      setError('Choose a customer first.');
      return;
    }

    // Branch 1: Indefinite Pause
    if (mode === 'pause') {
      const pauseStart = rangeStart || todayKey;
      startTransition(async () => {
        try {
          await pauseCustomer(activeTarget.id, pauseStart, null);
          const label = activeTarget.full_name?.trim() || 'Customer';
          showToast(`${label} paused indefinitely starting ${formatDateLabel(pauseStart)}`);
          window.dispatchEvent(new Event('tiffin:skip-synced'));
          onClose();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not pause customer.';
          setError(message);
          showToast(message, 'error');
        }
      });
      return;
    }

    // Branch 2: Standard Daily Skip or Undo Skip
    let finalDates = [...selected];

    if (mode === 'skip' && rangeStart && rangeEnd) {
      const startKey = normalizeDateInput(rangeStart);
      const endKey = normalizeDateInput(rangeEnd);
      if (startKey && endKey && endKey >= startKey) {
        const inRange = deliveryDatesInRange(startKey, endKey, scheduleForDates);
        finalDates = Array.from(new Set([...finalDates, ...inRange])).sort();
      }
    }

    if (finalDates.length === 0) {
      setError(mode === 'skip' ? 'Pick at least one date to skip.' : 'Pick at least one skip to undo.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await recordCustomerSkip({
          customerId: activeTarget.id,
          skipDates: finalDates,
          isSkipped: mode === 'skip',
          reason: reason.trim() || undefined,
        });

        if (result.success) {
          const label = activeTarget.full_name?.trim() || 'Customer';
          const end = result.newCycleEndDate ? ` · cycle ends ${result.newCycleEndDate}` : '';
          showToast(
            mode === 'skip' ? `Skip saved for ${label}${end}` : `Skip undone for ${label}${end}`
          );
          window.dispatchEvent(new Event('tiffin:skip-synced'));
          onSaved?.(result);
          onClose();
        } else {
          const message = result.message || 'Could not update the skip.';
          setError(message);
          showToast(message, 'error');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not update the skip.';
        setError(message);
        showToast(message, 'error');
      }
    });
  };

  if (!open) return null;

  const canSave = Boolean(activeTarget) && (mode === 'pause' || selected.length > 0) && !isPending;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Global delivery skip"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Ban className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <div>
              <h2 className="text-sm font-black tracking-tight text-gray-900">Skip a delivery</h2>
              <p className="text-[11px] font-semibold text-gray-400">
                Updates the override, cycle end date &amp; audit trail
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Customer */}
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-400">
              Customer
            </p>
            {activeTarget && !changingCustomer ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
                  <span className="truncate text-[13px] font-bold text-gray-800">
                    {activeTarget.full_name?.trim() || 'Selected customer'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPickedId(null);
                    setChangingCustomer(true);
                  }}
                  className="shrink-0 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-600 transition-all hover:bg-gray-100 duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search by name or phone…"
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13px] font-semibold text-gray-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200">
                  {loadingList ? (
                    <div className="flex items-center gap-2 px-3.5 py-3 text-[12px] font-semibold text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading customers…
                    </div>
                  ) : filteredCandidates.length === 0 ? (
                    <div className="px-3.5 py-3 text-[12px] font-semibold text-gray-400">
                      No matching customers.
                    </div>
                  ) : (
                    filteredCandidates.map(candidate => {
                      const isPicked = pickedId === candidate.id;
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => {
                            setPickedId(candidate.id);
                            setChangingCustomer(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 border-b border-gray-100 px-3.5 py-2.5 text-left last:border-b-0 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${isPicked ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
                            }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-gray-800">
                              {candidate.full_name?.trim() || 'Unnamed customer'}
                            </span>
                            {candidate.phone_number ? (
                              <span className="block truncate text-[11px] font-semibold text-gray-400">
                                {candidate.phone_number}
                              </span>
                            ) : null}
                          </span>
                          {isPicked ? (
                            <Check className="h-4 w-4 shrink-0 text-amber-700" strokeWidth={2.6} />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
                {target ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPickedId(null);
                      setChangingCustomer(false);
                      setQuery('');
                    }}
                    className="h-8 px-2 inline-flex items-center rounded-xl text-xs font-bold text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    Keep {target.full_name?.trim() || 'current customer'}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* Mode */}
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-400">Action</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('skip');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${mode === 'skip'
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
              >
                <Ban className="h-3.5 w-3.5" strokeWidth={2.4} /> Skip
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('pause');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${mode === 'pause'
                    ? 'border-[#5D5FEF]/30 bg-[#5D5FEF]/10 text-[#5D5FEF] ring-1 ring-[#5D5FEF]'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
              >
                <span>⏸️</span> Pause (Indefinite)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('undo');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${mode === 'undo'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
              >
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2.4} /> Undo skip
              </button>
            </div>
          </div>

          {/* Dates */}
          {/* Dates / Pause Configuration */}
          {mode === 'pause' ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2.5">
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-indigo-900 mb-1">
                  Pause Starts On
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={rangeStart || todayKey}
                    onChange={event => setRangeStart(event.target.value)}
                    className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-gray-800 bg-white outline-none focus:border-indigo-400"
                  />
                  <span className="text-xs text-indigo-700 font-semibold">
                    → Indefinite (No end date specified)
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-indigo-700 font-medium leading-relaxed">
                Freezes kitchen prep and deliveries starting on this day. When the customer confirms their return date later, resuming their service will automatically adjust their cycle end date by the days paused.
              </p>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-400">Dates</p>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyPreset(todayKey)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${selected.length === 1 && selected[0] === todayKey
                      ? 'border-amber-400 bg-amber-500 text-white'
                      : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(tomorrowKey)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${selected.length === 1 && selected[0] === tomorrowKey
                      ? 'border-amber-400 bg-amber-500 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  Tomorrow
                </button>
                {selected.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearDates}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-500 transition-all hover:bg-gray-50 duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {/* Multi-day range */}
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                <span className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-gray-500">
                  <CalendarDays className="h-3.5 w-3.5" /> Multi-day range
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={rangeStart}
                    max={rangeEnd || undefined}
                    onChange={event => {
                      const next = event.target.value;
                      setRangeStart(next);
                      if (next && rangeEnd) {
                        applyRangeDates(next, rangeEnd);
                      }
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                  <span className="text-[12px] font-bold text-gray-400">→</span>
                  <input
                    type="date"
                    value={rangeEnd}
                    min={rangeStart || undefined}
                    onChange={event => {
                      const next = event.target.value;
                      setRangeEnd(next);
                      if (rangeStart && next) {
                        applyRangeDates(rangeStart, next);
                      }
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                  <button
                    type="button"
                    onClick={addRange}
                    disabled={!rangeStart || !rangeEnd}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition-all hover:bg-amber-100 disabled:opacity-50 duration-150 cursor-pointer disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    Add range
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-gray-400">
                  Adds every scheduled delivery day between the two dates.
                </p>
              </div>

              {/* Upcoming delivery-day chips */}
              <div className="mt-2.5 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {deliveryDates
                  .filter(key => key !== todayKey && key !== tomorrowKey)
                  .map(key => {
                    const isSelected = selected.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleDate(key)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${isSelected
                            ? 'border-amber-400 bg-amber-500 text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                      >
                        {formatDateLabel(key)}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Live impact preview */}
          {preview ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5">
              <p className="text-[12.5px] font-bold text-indigo-900">
                {mode === 'skip' ? 'Skipping' : 'Restoring'} {preview.deliveryDays} delivery day
                {preview.deliveryDays === 1 ? '' : 's'}
                {preview.projectedEnd ? (
                  <>
                    {' '}
                    • Projected cycle end moves to {formatDateLong(preview.projectedEnd)} (
                    {preview.extraDays >= 0 ? '+' : '−'}
                    {Math.abs(preview.extraDays)} day
                    {Math.abs(preview.extraDays) === 1 ? '' : 's'})
                  </>
                ) : (
                  ' • Cycle end unchanged'
                )}
              </p>
              {preview.currentEnd && preview.projectedEnd ? (
                <p className="mt-0.5 text-[11px] font-semibold text-indigo-500">
                  Was {formatDateLabel(preview.currentEnd)} → now {formatDateLabel(preview.projectedEnd)}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Reason */}
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-400">
              Reason (optional)
            </p>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="e.g. Customer travelling"
              maxLength={160}
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[13px] font-semibold text-gray-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>

          {/* Selected summary */}
          {selected.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-amber-700">
                {selected.length} date{selected.length > 1 ? 's' : ''} selected
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDate(key)}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-amber-800 shadow-2xs transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    title="Remove"
                  >
                    {formatDateLabel(key)}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-bold text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50 duration-150 cursor-pointer disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-50 duration-150 cursor-pointer disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
              mode === 'skip'
                ? 'bg-amber-600 hover:bg-amber-700'
                : mode === 'pause'
                  ? 'bg-[#5D5FEF] hover:bg-[#4D4FD9]'
                  : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === 'skip' ? 'Skip delivery' : mode === 'pause' ? 'Pause indefinitely' : 'Undo skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
