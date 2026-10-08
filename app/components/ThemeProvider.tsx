'use client';

/**
 * Theme hydration & live theme engine (client).
 *
 * The root layout server-renders the whitelabel theme onto `<html>` (data-theme /
 * data-sidebar-style / inline primary ramp) and drops a tiny inline script in
 * `<head>` that re-applies the cached theme *before the first paint*. This
 * provider is the React half of that contract:
 *
 *   1. Its state starts from the very same source as the inline script
 *      (`readCachedBrandTheme`, falling back to the server branding), so React's
 *      first client render agrees with the DOM it hydrates — no mismatch. See
 *      node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 *   2. Every committed state is stamped back onto `document.documentElement` and
 *      cached to `localStorage`, which is what makes a reload flash-free.
 *   3. Whenever fresh server branding arrives (`router.refresh()` / a new RSC
 *      payload) the server wins and any optimistic preview is dropped.
 *
 * `setTheme()` lets the branding settings screen preview a preset / custom hex
 * instantly, before the server action answers; `resetTheme()` snaps back.
 *
 * Guardrails: only the primary ramp is ever overridden. The console sidebar
 * keeps its preset surface (`bg-brand-sidebar` / `--brand-sidebar-bg`, dark by
 * default) and the semantic food/status colours (Veg=emerald, Non-Veg=rose,
 * Active=emerald, Paused=amber, Cancelled=rose) stay fixed Tailwind utilities.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyBrandTheme,
  brandThemeSignature,
  clearCachedBrandTheme,
  normalizeBrandTheme,
  readCachedBrandTheme,
  toBrandTheme,
  writeCachedBrandTheme,
  type BrandTheme,
  type BusinessBranding,
} from '@/app/utils/branding';

/** `useLayoutEffect` warns during SSR — this provider also renders on the server. */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type ThemeProviderProps = {
  /** The server-resolved `public.business_settings` row (source of truth). */
  branding: Pick<
    BusinessBranding,
    | 'theme_preset'
    | 'custom_primary_hex'
    | 'sidebar_style'
    | 'business_name'
    | 'logo_url'
    | 'favicon_url'
  >;
  children: React.ReactNode;
};

/** The white-label identity the shell chrome renders (wordmark, logo, favicon). */
export type BrandingIdentity = Pick<
  BusinessBranding,
  'business_name' | 'logo_url' | 'favicon_url'
>;

export type ThemeContextValue = {
  /** The active branding identity — sidebar logo and browser-tab icon. */
  branding: BrandingIdentity;
  /** The theme currently stamped on `<html>`. */
  theme: BrandTheme;
  /** The server's theme — what a reload / persist converges to. */
  serverTheme: BrandTheme;
  /** `theme` is ahead of `serverTheme` (an unsaved, cached preview). */
  isPreview: boolean;
  /** Applies + caches a partial theme immediately (branding UI live preview). */
  setTheme: (patch: Partial<BrandTheme>) => void;
  /** Drops the cached override and snaps back to the server theme. */
  resetTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export default function ThemeProvider({ branding, children }: ThemeProviderProps) {
  const { theme_preset, custom_primary_hex, sidebar_style, business_name, logo_url, favicon_url } =
    branding;

  const serverTheme = useMemo(
    () =>
      toBrandTheme({
        theme_preset,
        custom_primary_hex,
        sidebar_style,
      }),
    [theme_preset, custom_primary_hex, sidebar_style]
  );
  const serverSignature = brandThemeSignature(serverTheme);

  // Passed straight through from the server-resolved row: the shell renders
  // whatever the kitchen configured, or the stock TiffinOS marks when blank.
  const brandingIdentity = useMemo<BrandingIdentity>(
    () => ({ business_name, logo_url, favicon_url }),
    [business_name, logo_url, favicon_url]
  );

  // Server render → server theme; client render → the cache the inline script
  // already applied (or the server theme when there is nothing cached).
  const [theme, setThemeState] = useState<BrandTheme>(
    () => readCachedBrandTheme(serverTheme) ?? serverTheme
  );

  // Stamp + cache synchronously, before the browser paints the update.
  useIsomorphicLayoutEffect(() => {
    applyBrandTheme(theme);
    writeCachedBrandTheme(theme, serverTheme);
  }, [theme, serverTheme]);

  // A *new* server value (branding saved elsewhere, router.refresh()) always
  // wins over a stale optimistic preview.
  const lastServerSignature = useRef(serverSignature);

  useEffect(() => {
    if (lastServerSignature.current === serverSignature) return;
    lastServerSignature.current = serverSignature;
    setThemeState(serverTheme);
  }, [serverSignature, serverTheme]);

  const setTheme = useCallback((patch: Partial<BrandTheme>) => {
    setThemeState(previous => normalizeBrandTheme({ ...previous, ...patch }));
  }, []);

  const resetTheme = useCallback(() => {
    clearCachedBrandTheme();
    setThemeState(serverTheme);
  }, [serverTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      serverTheme,
      branding: brandingIdentity,
      isPreview: brandThemeSignature(theme) !== serverSignature,
      setTheme,
      resetTheme,
    }),
    [theme, serverTheme, brandingIdentity, serverSignature, setTheme, resetTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reads the live theme. Must be used inside `<ThemeProvider>` (app/layout.tsx). */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within <ThemeProvider> (see app/layout.tsx)');
  }
  return context;
}

/**
 * Reads the active white-label identity (wordmark, logo, favicon).
 *
 * Null-safe on purpose: shell chrome such as the sidebar logo and
 * <DynamicFavicon /> (app/components/DynamicFavicon.tsx) should fall back to the
 * stock TiffinOS marks rather than crash if it is ever rendered outside the
 * provider.
 */
export function useBranding(): BrandingIdentity | null {
  const context = useContext(ThemeContext);
  return context?.branding ?? null;
}
