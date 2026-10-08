/**
 * White-label branding & global theme engine — shared tokens.
 *
 * TiffinOS ships with five stock brand presets. A commercial kitchen can either
 * pick a preset or supply a custom primary hex, and choose whether the console
 * sidebar renders dark (default) or light.
 *
 * Runtime contract (app/globals.css + tailwind.config.ts):
 *   --brand-primary        R G B  →  bg-brand / text-brand / border-brand
 *   --brand-primary-hover  R G B  →  hover:bg-brand-hover
 *   --brand-primary-light  R G B  →  bg-brand-light
 *   --brand-sidebar-bg     R G B  →  bg-brand-sidebar
 *
 * This module is intentionally framework-free (no `'use server'`) so both the
 * server actions in app/admin/actions.ts and client components can import it.
 */

export const THEME_PRESETS = ['indigo', 'saffron', 'emerald', 'ruby', 'cobalt'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export const DEFAULT_THEME_PRESET: ThemePreset = 'indigo';

export const SIDEBAR_STYLES = ['dark', 'light'] as const;

export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

export const DEFAULT_SIDEBAR_STYLE: SidebarStyle = 'dark';

/** The single row of `public.business_settings` — the white-label source of truth. */
export type BusinessBranding = {
  id: string;
  business_name: string;
  tagline: string | null;
  logo_url: string | null;
  /** Optional dedicated browser-tab icon; falls back to `logo_url`. */
  favicon_url: string | null;
  theme_preset: ThemePreset;
  custom_primary_hex: string | null;
  sidebar_style: SidebarStyle;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Stock TiffinOS branding — also the fallback when the table is not installed yet. */
export const DEFAULT_BRANDING: BusinessBranding = {
  id: 'default',
  business_name: 'TiffinOS',
  tagline: 'Commercial Kitchen & Meal-Prep Operating System',
  logo_url: null,
  favicon_url: null,
  theme_preset: DEFAULT_THEME_PRESET,
  custom_primary_hex: null,
  sidebar_style: DEFAULT_SIDEBAR_STYLE,
};

/** Swatch metadata, kept in one place so the branding UI can render pickers. */
export type ThemePresetSwatch = {
  id: ThemePreset;
  label: string;
  /** Mirrors the `html[data-theme="…"]` block in app/globals.css. */
  primaryHex: string;
  hoverHex: string;
  lightHex: string;
  sidebarHex: string;
};

export const THEME_PRESET_SWATCHES: readonly ThemePresetSwatch[] = [
  { id: 'indigo', label: 'Indigo', primaryHex: '#5D5FEF', hoverHex: '#4D4FD9', lightHex: '#EFEEFC', sidebarHex: '#0F1222' },
  { id: 'saffron', label: 'Saffron', primaryHex: '#EA580C', hoverHex: '#C2410C', lightHex: '#FFF7ED', sidebarHex: '#1C130E' },
  { id: 'emerald', label: 'Emerald', primaryHex: '#059669', hoverHex: '#047857', lightHex: '#ECFDF5', sidebarHex: '#0B1A14' },
  { id: 'ruby', label: 'Ruby', primaryHex: '#E11D48', hoverHex: '#BE123C', lightHex: '#FFF1F2', sidebarHex: '#1A0F14' },
  { id: 'cobalt', label: 'Cobalt', primaryHex: '#2563EB', hoverHex: '#1D4ED8', lightHex: '#EFF6FF', sidebarHex: '#090D16' },
] as const;

export const isThemePreset = (value: unknown): value is ThemePreset =>
  typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value);

export const isSidebarStyle = (value: unknown): value is SidebarStyle =>
  typeof value === 'string' && (SIDEBAR_STYLES as readonly string[]).includes(value);

const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

/** `'5d5fef'` / `'#5d5fef'` → `'#5D5FEF'`. Anything else → `null`. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(HEX_PATTERN);
  return match ? `#${match[1].toUpperCase()}` : null;
}

/** `'#5D5FEF'` → `'93 95 239'` (the `R G B` triplet shape our CSS variables expect). */
export function hexToRgbTriplet(hex: string | null | undefined): string | null {
  if (typeof hex !== 'string') return null;
  const match = hex.trim().match(HEX_PATTERN);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Blends every channel toward white (`amount > 0`) or black (`amount < 0`). */
function shiftHex(hex: string, amount: number): string {
  const match = normalizeHex(hex)?.match(HEX_PATTERN);
  if (!match) return hex;
  const int = parseInt(match[1], 16);
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  const blend = (channel: number) => clampChannel(channel + (target - channel) * ratio);
  const r = blend((int >> 16) & 255);
  const g = blend((int >> 8) & 255);
  const b = blend(int & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/** CSS custom properties for the brand ramp (`R G B` triplets). */
export type BrandStyleVars = Record<`--${string}`, string>;

/**
 * Resolves the brand ramp overrides for the root layout.
 *
 * Presets are pure CSS (`html[data-theme="…"]`), so a preset selection returns
 * an empty object. A custom hex returns the primary ramp only — the sidebar
 * keeps its preset surface colour, which guarantees the dark console chrome
 * stays legible.
 */
export function buildBrandStyleVars(
  branding: Pick<BusinessBranding, 'theme_preset' | 'custom_primary_hex'>
): BrandStyleVars {
  const custom = normalizeHex(branding.custom_primary_hex);
  if (!custom) return {};

  const primary = hexToRgbTriplet(custom);
  const hover = hexToRgbTriplet(shiftHex(custom, -0.12));
  const light = hexToRgbTriplet(shiftHex(custom, 0.92));
  if (!primary || !hover || !light) return {};

  return {
    '--brand-primary': primary,
    '--brand-primary-hover': hover,
    '--brand-primary-light': light,
  };
}

/**
 * Resolves the browser-tab icon for a branding row.
 *
 * Priority: a dedicated `favicon_url`, then the console `logo_url`, then `''`
 * — in which case callers keep the shipped default icon (app/favicon.ico).
 * Shared by <DynamicFavicon /> (app/components/DynamicFavicon.tsx) and the
 * settings preview so the live tab icon and the UI never disagree.
 */
export function resolveBrandFavicon(
  branding: Pick<BusinessBranding, 'favicon_url' | 'logo_url'>
): string {
  return (branding.favicon_url ?? '').trim() || (branding.logo_url ?? '').trim();
}

/** The swatch currently in effect (falls back to the indigo stock preset). */
export function resolveThemeSwatch(preset: ThemePreset): ThemePresetSwatch {
  return THEME_PRESET_SWATCHES.find(swatch => swatch.id === preset) ?? THEME_PRESET_SWATCHES[0];
}

/** The brand ramp actually in effect — preset values with a custom hex applied. */
export type ResolvedBrandRamp = {
  primaryHex: string;
  hoverHex: string;
  lightHex: string;
  sidebarHex: string;
};

/**
 * Resolves the ramp a given preset + optional custom hex renders as.
 *
 * This mirrors `buildBrandStyleVars` exactly (hover = −12% toward black,
 * light = +92% toward white), so previews built on it always agree with what
 * the root layout stamps on `<html>`.
 *
 * The sidebar surface stays preset-driven: the console keeps
 * `bg-brand-sidebar` / `--brand-sidebar-bg`, so a custom accent can never
 * repaint (or illegibly tint) the chrome.
 */
export function resolveBrandRamp(
  preset: ThemePreset,
  customPrimaryHex: string | null | undefined
): ResolvedBrandRamp {
  const swatch = resolveThemeSwatch(preset);
  const custom = normalizeHex(customPrimaryHex);
  if (!custom) {
    return {
      primaryHex: swatch.primaryHex,
      hoverHex: swatch.hoverHex,
      lightHex: swatch.lightHex,
      sidebarHex: swatch.sidebarHex,
    };
  }
  return {
    primaryHex: custom,
    hoverHex: shiftHex(custom, -0.12),
    lightHex: shiftHex(custom, 0.92),
    sidebarHex: swatch.sidebarHex,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   RUNTIME / HYDRATION LAYER
   ─────────────────────────────────────────────────────────────────────────────
   The root layout (app/layout.tsx) server-renders the theme straight onto
   <html>, which is what keeps a fresh load flash-free. This half of the module
   powers everything that happens *in the browser*:

     • applyBrandTheme()                → re-stamp <html> from client state
     • read/write/clearCachedBrandTheme → localStorage cache (anti-flash)
     • buildBrandThemeBootstrapScript() → pre-paint <head> script

   app/components/ThemeProvider.tsx is the only writer of live client state and
   consumes these helpers, so the inline script, the provider and the server
   render can never drift apart.
   ───────────────────────────────────────────────────────────────────────── */

/** `localStorage` key holding the last theme the browser painted. */
export const BRAND_THEME_STORAGE_KEY = 'tiffinos.brand-theme.v1';

/** Cache schema version — bumped whenever the payload shape changes. */
const BRAND_THEME_CACHE_VERSION = 1;

/** The inline primary-ramp tokens a custom `custom_primary_hex` overrides. */
const BRAND_PRIMARY_TOKENS = [
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-light',
] as const;

/**
 * The theme the browser is rendering — the preset plus an optional custom
 * primary hex and the sidebar surface style. This is the client-side mirror of
 * the three `public.business_settings` columns the root layout reads.
 */
export type BrandTheme = {
  preset: ThemePreset;
  customPrimaryHex: string | null;
  sidebarStyle: SidebarStyle;
};

/** Coerces any partially-trusted input (props / cache payload) into a safe theme. */
export function normalizeBrandTheme(input: Partial<BrandTheme> | null | undefined): BrandTheme {
  return {
    preset: isThemePreset(input?.preset) ? input.preset : DEFAULT_THEME_PRESET,
    customPrimaryHex: normalizeHex(input?.customPrimaryHex ?? null),
    sidebarStyle: isSidebarStyle(input?.sidebarStyle) ? input.sidebarStyle : DEFAULT_SIDEBAR_STYLE,
  };
}

/** Projects a `public.business_settings` row into the runtime theme shape. */
export function toBrandTheme(
  branding: Pick<BusinessBranding, 'theme_preset' | 'custom_primary_hex' | 'sidebar_style'>
): BrandTheme {
  return normalizeBrandTheme({
    preset: branding.theme_preset,
    customPrimaryHex: branding.custom_primary_hex,
    sidebarStyle: branding.sidebar_style,
  });
}

/** Cheap identity for change detection / cache invalidation. */
export function brandThemeSignature(theme: BrandTheme): string {
  return `${theme.preset}|${theme.customPrimaryHex ?? ''}|${theme.sidebarStyle}`;
}

/**
 * Stamps a theme onto `<html>` — exactly the three things the root layout
 * server-renders:
 *
 *   data-theme          → the preset ramp in app/globals.css
 *   data-sidebar-style  → dark (stock console chrome) | light
 *   --brand-primary[-hover|-light] → inline override for a custom hex
 *
 * Sidebar tokens (`--brand-sidebar-bg` / `-fg*`) are deliberately never touched
 * here: the console keeps its preset surface (`bg-brand-sidebar`), so the dark
 * chrome stays legible under every preset. The semantic food/status colours
 * (Veg/Non-Veg, Active/Paused/Cancelled) are plain Tailwind utilities that this
 * ramp cannot reach.
 */
export function applyBrandTheme(theme: BrandTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;

  root.setAttribute('data-theme', theme.preset);
  root.setAttribute('data-sidebar-style', theme.sidebarStyle);

  const ramp = buildBrandStyleVars({
    theme_preset: theme.preset,
    custom_primary_hex: theme.customPrimaryHex,
  });

  for (const token of BRAND_PRIMARY_TOKENS) {
    const value = ramp[token];
    // No custom hex → drop the override so the preset ramp wins again.
    if (value) root.style.setProperty(token, value);
    else root.style.removeProperty(token);
  }
}

/** The versioned payload persisted to `localStorage`. */
type BrandThemeCachePayload = {
  v: number;
  /** Signature of the *server* theme this entry was written on top of. */
  base: string;
  preset: ThemePreset;
  hex: string | null;
  sidebar: SidebarStyle;
  /** Pre-derived ramp, so the pre-paint script never has to do colour math. */
  ramp: BrandStyleVars;
};

/**
 * Persists the painted theme. `serverTheme` is recorded as the baseline so a
 * later read can tell an in-flight optimistic preview apart from a cache that
 * another device has since superseded.
 */
export function writeCachedBrandTheme(theme: BrandTheme, serverTheme: BrandTheme): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: BrandThemeCachePayload = {
      v: BRAND_THEME_CACHE_VERSION,
      base: brandThemeSignature(serverTheme),
      preset: theme.preset,
      hex: theme.customPrimaryHex,
      sidebar: theme.sidebarStyle,
      ramp: buildBrandStyleVars({
        theme_preset: theme.preset,
        custom_primary_hex: theme.customPrimaryHex,
      }),
    };
    window.localStorage.setItem(BRAND_THEME_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing / disabled storage / quota — the cache is best-effort.
  }
}

/**
 * Reads the cached theme, discarding anything malformed, written by an older
 * schema, or stamped against a different server theme (i.e. another device has
 * changed the branding since). `null` → render the server theme as-is.
 */
export function readCachedBrandTheme(serverTheme: BrandTheme): BrandTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BRAND_THEME_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as Partial<BrandThemeCachePayload> | null;
    if (!payload || payload.v !== BRAND_THEME_CACHE_VERSION) return null;
    if (payload.base !== brandThemeSignature(serverTheme)) return null;
    // Strict — identical to the validation inlined in the bootstrap script, so
    // the DOM the script painted and this client state always agree.
    if (!isThemePreset(payload.preset) || !isSidebarStyle(payload.sidebar)) return null;
    const customPrimaryHex = normalizeHex(payload.hex ?? null);
    if (payload.hex != null && !customPrimaryHex) return null;
    return { preset: payload.preset, customPrimaryHex, sidebarStyle: payload.sidebar };
  } catch {
    // Unparseable payload / unavailable storage — fall back to the server theme.
    return null;
  }
}

/** Drops the cached theme so the next paint uses the server branding. */
export function clearCachedBrandTheme(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(BRAND_THEME_STORAGE_KEY);
  } catch {
    // Nothing to do — see writeCachedBrandTheme.
  }
}

/**
 * Builds the tiny inline `<head>` script that re-applies a cached theme while the
 * browser parses the HTML — i.e. *before* the first paint and long before React
 * hydrates (see node_modules/next/dist/docs/01-app/02-guides/
 * preventing-flash-before-hydration.md). With no cache it is a no-op, leaving
 * the theme the server already stamped on `<html>`.
 *
 * Self-contained ES5 with zero dependencies, because `<head>` scripts execute
 * before any bundle has loaded. The payload is schema- and baseline-checked and
 * every value is re-validated (preset list, sidebar list, `R G B` triplet shape)
 * so a hand-edited cache can never stamp garbage on the document.
 */
export function buildBrandThemeBootstrapScript(serverTheme: BrandTheme): string {
  const key = JSON.stringify(BRAND_THEME_STORAGE_KEY);
  const presets = JSON.stringify(THEME_PRESETS);
  const sidebarStyles = JSON.stringify(SIDEBAR_STYLES);
  const tokens = JSON.stringify(BRAND_PRIMARY_TOKENS);
  const baseline = JSON.stringify(brandThemeSignature(serverTheme));

  return [
    '(function(){try{',
    `var K=${key},V=${BRAND_THEME_CACHE_VERSION},B=${baseline},P=${presets},S=${sidebarStyles},T=${tokens};`,
    'var c=window.localStorage.getItem(K);if(!c)return;',
    'var d=JSON.parse(c);',
    'if(!d||d.v!==V||d.base!==B||P.indexOf(d.preset)<0||S.indexOf(d.sidebar)<0)return;',
    'var e=document.documentElement,r=d.ramp||{},i,v;',
    'e.setAttribute("data-theme",d.preset);',
    'e.setAttribute("data-sidebar-style",d.sidebar);',
    'for(i=0;i<T.length;i++){v=r[T[i]];',
    'if(typeof v==="string"&&/^\\d{1,3} \\d{1,3} \\d{1,3}$/.test(v))e.style.setProperty(T[i],v);',
    'else e.style.removeProperty(T[i]);}',
    '}catch(e){}})()',
  ].join('');
}
