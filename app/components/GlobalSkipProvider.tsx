'use client';

/**
 * Global Skip provider — mounts the one shared skip modal and exposes
 * `useGlobalSkip()` so ANY surface (global header, customer row, prep drawer)
 * can open it, optionally pre-selecting a customer / mode / dates.
 *
 * Mounted exactly once by `app/layout.tsx` (the root layout), mirroring the
 * ToastProvider / ThemeProvider contract — so a single instance already covers
 * BOTH /admin and /prep (plus the auth routes). That is why there is
 * deliberately no per-route provider in app/admin/layout.tsx or
 * app/prep/layout.tsx.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import GlobalSkipModal, { type GlobalSkipMode, type GlobalSkipTarget } from './GlobalSkipModal';

/** Lightweight customer reference accepted by `openSkipModal()`. */
export type SkipCustomerRef = { id: string; name: string };

/** Legacy option-bag entry point (kept for pre-existing callers). */
export type OpenGlobalSkipOptions = {
  target?: GlobalSkipTarget | null;
  mode?: GlobalSkipMode;
  dates?: string[];
};

export type GlobalSkipContextValue = {
  /**
   * Opens the shared skip modal, optionally pre-selecting a customer (rendered as
   * a locked pill, with a Change affordance) and/or a default date key to seed
   * the draft with (usually `toLocalDateKey(new Date())`).
   */
  openSkipModal: (customer?: SkipCustomerRef, defaultDateKey?: string) => void;
  /** Closes the shared skip modal. */
  closeSkipModal: () => void;
  /** True while the skip modal is open. */
  isOpen: boolean;
  /** The customer the modal opened with (null ⇒ the searchable picker shows). */
  selectedCustomer: SkipCustomerRef | null;
  /** The date key the modal opened with ('' when none). */
  defaultDateKey: string;

  /** Backward-compatible aliases for the original API. */
  openGlobalSkip: (options?: OpenGlobalSkipOptions) => void;
  closeGlobalSkip: () => void;
  isGlobalSkipOpen: boolean;
};

const GlobalSkipContext = createContext<GlobalSkipContextValue | null>(null);

export default function GlobalSkipProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Bumped on every open so the modal remounts with a clean draft.
  const [openCount, setOpenCount] = useState(0);
  const [target, setTarget] = useState<GlobalSkipTarget | null>(null);
  const [mode, setMode] = useState<GlobalSkipMode>('skip');
  const [dates, setDates] = useState<string[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SkipCustomerRef | null>(null);
  const [defaultDateKey, setDefaultDateKey] = useState('');

  // Spec API — pre-selects a customer (shown as a locked pill in the modal) and
  // seeds the draft with a default date key.
  const openSkipModal = useCallback((customer?: SkipCustomerRef, dateKey?: string) => {
    const nextDate = typeof dateKey === 'string' ? dateKey : '';
    setSelectedCustomer(customer ?? null);
    setDefaultDateKey(nextDate);
    setTarget(customer ? { id: customer.id, full_name: customer.name } : null);
    setMode('skip');
    setDates(nextDate ? [nextDate] : []);
    setOpenCount(count => count + 1);
    setOpen(true);
  }, []);

  const closeSkipModal = useCallback(() => setOpen(false), []);

  // Legacy option-bag entry point → the exact same state as `openSkipModal`.
  const openGlobalSkip = useCallback((options?: OpenGlobalSkipOptions) => {
    const nextTarget = options?.target ?? null;
    const nextDates = options?.dates ?? [];
    setTarget(nextTarget);
    setMode(options?.mode ?? 'skip');
    setDates(nextDates);
    setSelectedCustomer(
      nextTarget ? { id: nextTarget.id, name: nextTarget.full_name?.trim() || 'Customer' } : null
    );
    setDefaultDateKey(nextDates[0] ?? '');
    setOpenCount(count => count + 1);
    setOpen(true);
  }, []);

  const value = useMemo<GlobalSkipContextValue>(
    () => ({
      openSkipModal,
      closeSkipModal,
      isOpen: open,
      selectedCustomer,
      defaultDateKey,
      openGlobalSkip,
      closeGlobalSkip: closeSkipModal,
      isGlobalSkipOpen: open,
    }),
    [openSkipModal, closeSkipModal, open, selectedCustomer, defaultDateKey, openGlobalSkip]
  );

  return (
    <GlobalSkipContext.Provider value={value}>
      {children}
      <GlobalSkipModal
        key={openCount}
        open={open}
        target={target}
        initialMode={mode}
        initialDates={dates}
        onClose={closeSkipModal}
      />
    </GlobalSkipContext.Provider>
  );
}

/** Reads the global skip surface. Must be used inside `<GlobalSkipProvider>`. */
export function useGlobalSkip() {
  const context = useContext(GlobalSkipContext);
  if (!context) {
    // Return safe fallback so SSR and edge layout transitions don't crash
    return {
      openSkipModal: () => console.warn('[useGlobalSkip] Called outside GlobalSkipProvider'),
      closeSkipModal: () => {},
      isModalOpen: false,
    };
  }
  return context;
}
