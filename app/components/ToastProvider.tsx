'use client';

/**
 * Global floating toast surface — the single notification primitive of the console.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Pages used to render their own inline alert banners (a `bg-emerald-50` block
 * inserted between the page header and the first card). Every appearance /
 * disappearance pushed the whole page down — a real layout shift — and every
 * page dressed the same feedback differently. This provider replaces all of
 * that with one bottom-right floating stack matching the pattern already shipped
 * in `CustomerSplitLayout` (`fixed bottom-5 right-5 z-[70]`, ~3.2s auto-dismiss,
 * emerald success / rose error), so a save can never move a pixel of content.
 *
 * USAGE (client components only)
 * ──────────────────────────────
 *   const { showToast } = useToast();
 *   showToast('Branding saved — the theme is live across the console.'); // success
 *   showToast('Failed to save settings', 'error');
 *
 * Mounted exactly once, globally, by `app/layout.tsx`, so every route (admin,
 * prep, auth) shares the same surface. The stack is `fixed`, i.e. taken out of
 * flow entirely — that is what guarantees zero CLS for callers. Rendering it
 * inline (instead of a `createPortal` dance) is deliberate: the provider mounts
 * at the top of `<body>`, so the container already *is* body-level.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, AlertTriangle, Check, Info } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type ToastContextValue = {
  /**
   * Queues a floating toast in the bottom-right stack.
   *
   * Re-announcing the exact same `message` + `kind` while it is still on screen
   * only extends its lifetime instead of stacking an identical clone (rapid
   * re-saves stay quiet). Returns the toast id, usable with `dismissToast`.
   */
  showToast: (message: string, kind?: ToastKind) => number;
  /** Plays the exit animation early and unmounts the toast. */
  dismissToast: (id: number) => void;
};

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
  /** Set while the exit keyframes play, just before unmount. */
  leaving: boolean;
};

/** Reference timing from CustomerSplitLayout — long enough to read, short enough to stay out of the way. */
const AUTO_DISMISS_MS = 3200;
/** Matches the `duration-150` exit animation below. */
const EXIT_MS = 150;
/** Hard cap on the stack — oldest fall off the top so the corner never floods. */
const MAX_VISIBLE = 4;

/**
 * Semantic skins. Food/status semantics are fixed in this console
 * (Veg=emerald, Non-Veg=rose, Paused=amber), so the toast palette follows the
 * same rules rather than the brand ramp.
 */
const KIND_SKINS: Record<ToastKind, { surface: string; Icon: typeof Check; label: string }> = {
  success: { surface: 'bg-emerald-600', Icon: Check, label: 'Success' },
  error: { surface: 'bg-rose-600', Icon: AlertTriangle, label: 'Error' },
  warning: { surface: 'bg-amber-600', Icon: AlertCircle, label: 'Warning' },
  info: { surface: 'bg-indigo-600', Icon: Info, label: 'Information' },
};

const ToastContext = createContext<ToastContextValue | null>(null);

type TimerMap = React.RefObject<Map<number, ReturnType<typeof setTimeout>>>;

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  /** Monotonic id source — never reused, so timers can't collide across toasts. */
  const nextIdRef = useRef(0);
  /** Latest queued stack, read by `showToast` for de-duplication. */
  const toastsRef = useRef<ToastItem[]>([]);
  /** Auto-dismiss timers (one per live toast). */
  const autoTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Unmount timers started once a toast begins its exit animation. */
  const exitTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // `showToast` mirrors the queue synchronously (so two calls in the same tick
  // still de-duplicate correctly), while this effect keeps the ref converging on
  // the committed state — otherwise dismissed toasts would linger in the mirror
  // and a later identical message would silently never re-appear.
  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const clearTimer = useCallback((timers: TimerMap, id: number) => {
    const timer = timers.current?.get(id);
    if (!timer) return;
    clearTimeout(timer);
    timers.current?.delete(id);
  }, []);

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(autoTimersRef, id);
      // Mark as leaving first: the pill fades out, then unmounts — the remaining
      // stack closes the gap instead of jumping.
      setToasts(prev => prev.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
      if (exitTimersRef.current.has(id)) return;
      exitTimersRef.current.set(
        id,
        setTimeout(() => {
          exitTimersRef.current.delete(id);
          setToasts(prev => prev.filter(toast => toast.id !== id));
        }, EXIT_MS)
      );
    },
    [clearTimer]
  );

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const text = message.trim();
      if (!text) return -1;

      // Same message still on screen → just restart its clock.
      const duplicate = toastsRef.current.find(
        toast => !toast.leaving && toast.kind === kind && toast.message === text
      );
      if (duplicate) {
        clearTimer(autoTimersRef, duplicate.id);
        autoTimersRef.current.set(
          duplicate.id,
          setTimeout(() => dismissToast(duplicate.id), AUTO_DISMISS_MS)
        );
        return duplicate.id;
      }

      nextIdRef.current += 1;
      const id = nextIdRef.current;
      // Mirror the queue synchronously so two calls in the same tick still dedupe.
      toastsRef.current = [...toastsRef.current, { id, message: text, kind, leaving: false }].slice(
        -MAX_VISIBLE
      );
      setToasts(toastsRef.current);

      autoTimersRef.current.set(id, setTimeout(() => dismissToast(id), AUTO_DISMISS_MS));
      return id;
    },
    [clearTimer, dismissToast]
  );

  // Never leave a timer behind: StrictMode double-mounts in dev and pages unmount
  // constantly on navigation.
  useEffect(() => {
    const autoTimers = autoTimersRef.current;
    const exitTimers = exitTimersRef.current;
    return () => {
      autoTimers.forEach(clearTimeout);
      autoTimers.clear();
      exitTimers.forEach(clearTimeout);
      exitTimers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Floating stack — `fixed` keeps it out of flow; `pointer-events-none` lets
          clicks pass through everywhere except the pills themselves. */}
      <div
        className="fixed bottom-5 right-5 z-[70] flex flex-col gap-2 pointer-events-none"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map(toast => {
          const { surface, Icon, label } = KIND_SKINS[toast.kind];
          return (
            <div
              key={toast.id}
              role="status"
              aria-label={label}
              className={[
                'pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 shadow-xl',
                'text-[13px] font-semibold text-white max-w-[min(92vw,26rem)]',
                surface,
                toast.leaving
                  ? 'animate-out fade-out slide-out-to-bottom-2 duration-150'
                  : 'animate-in fade-in slide-in-from-bottom-2 duration-200',
              ].join(' ')}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={2.5} />
              <span className="min-w-0">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Reads the global toast surface. Must be used inside `<ToastProvider>`
 * (mounted by app/layout.tsx) — mirrors the `useTheme` contract in
 * app/components/ThemeProvider.tsx.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within <ToastProvider> (see app/layout.tsx)');
  }
  return context;
}
