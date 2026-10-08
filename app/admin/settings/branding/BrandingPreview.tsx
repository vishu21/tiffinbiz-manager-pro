'use client';

import type { CSSProperties } from 'react';
import { Check, Eye, Palette, Settings, Truck, Users, Utensils } from 'lucide-react';
import { resolveBrandRamp, type SidebarStyle, type ThemePreset } from '@/app/utils/branding';

/**
 * Live mini-preview for the Branding & Appearance screen.
 *
 * Renders the surfaces an operator actually judges a palette by — the primary
 * button, the brand pill, the console sidebar badge and the browser tab (icon
 * resolved `favicon_url → logo_url`, mirroring <DynamicFavicon>) — straight from
 * the *unsaved* form state, so a preset / custom accent — or a freshly uploaded
 * logo / favicon — can be compared before `updateBusinessBranding` is called.
 *
 * Everything is driven by CSS custom properties scoped to this subtree (never
 * `document.documentElement`), so the preview is a pure dry run: the real
 * console theme only moves once the server action answers and revalidates. The
 * `--prev-*` tokens mirror the runtime contract in app/globals.css +
 * tailwind.config.ts:
 *   --prev-primary        ≈ bg-brand / text-brand
 *   --prev-primary-hover  ≈ hover:bg-brand-hover
 *   --prev-primary-light  ≈ bg-brand-light
 *   --prev-sidebar        ≈ bg-brand-sidebar (--brand-sidebar-bg)
 *   --prev-sidebar-fg*    ≈ --brand-sidebar-fg / -fg-soft / -fg-muted
 *
 * Guardrail: the semantic food/status badges at the bottom are rendered with
 * fixed Tailwind utilities (Veg=emerald, Non-Veg=rose, Active=emerald,
 * Paused=amber, Cancelled=rose) specifically to document that they are NOT
 * brand-driven and never move with the palette.
 */

/** CSS custom properties are not part of `CSSProperties` — the index signature adds them. */
type PreviewStyle = CSSProperties & Record<`--${string}`, string>;

/** Mirrors the `html[data-sidebar-style="light"]` block in app/globals.css. */
const LIGHT_CHROME = {
  bg: '#F8FAFC',
  fg: '#0F1222',
  fgSoft: '#334155',
  fgMuted: '#64748B',
  border: 'rgba(15, 18, 34, 0.08)',
} as const;

/** Mirrors the stock dark chrome (`--brand-sidebar-*` defaults) in app/globals.css. */
const DARK_CHROME = {
  fg: '#FFFFFF',
  fgSoft: '#CBD5E1',
  fgMuted: '#94A3B8',
  border: 'rgba(255, 255, 255, 0.1)',
} as const;

export type BrandingPreviewProps = {
  businessName: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
  preset: ThemePreset;
  customPrimaryHex: string | null;
  sidebarStyle: SidebarStyle;
};

export default function BrandingPreview({
  businessName,
  tagline,
  logoUrl,
  faviconUrl,
  preset,
  customPrimaryHex,
  sidebarStyle,
}: BrandingPreviewProps) {
  const ramp = resolveBrandRamp(preset, customPrimaryHex);

  // Custom accents never repaint the chrome — only the preset moves the surface.
  const chrome =
    sidebarStyle === 'light' ? LIGHT_CHROME : { bg: ramp.sidebarHex, ...DARK_CHROME };

  const tokens: PreviewStyle = {
    '--prev-primary': ramp.primaryHex,
    '--prev-primary-hover': ramp.hoverHex,
    '--prev-primary-light': ramp.lightHex,
    '--prev-sidebar': chrome.bg,
    '--prev-sidebar-fg': chrome.fg,
    '--prev-sidebar-fg-soft': chrome.fgSoft,
    '--prev-sidebar-fg-muted': chrome.fgMuted,
    '--prev-sidebar-border': chrome.border,
  };

  const wordmark = businessName.trim() || 'Your Kitchen';
  const subline = tagline.trim();

  /**
   * Browser-tab icon resolution, mirroring app/components/DynamicFavicon.tsx
   * exactly: custom favicon → configured logo → the shipped TiffinOS default.
   * An upload that lands only in `logo_url` therefore still shows up as the tab
   * icon here, so the operator sees the real outcome before saving.
   */
  const faviconSrc = faviconUrl.trim() || logoUrl.trim();
  const faviconIsFallback = !faviconUrl.trim() && Boolean(logoUrl.trim());

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-5 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Live Mini-Preview</h3>
        </div>
        <span className="text-[10.5px] font-bold text-gray-400">
          Preview only — nothing changes until you save
        </span>
      </div>

      <div style={tokens} className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
        {/* ── BROWSER TAB MOCK (favicon_url → logo_url) ── */}
        <div className="2xl:col-span-2 space-y-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
            Browser tab — favicon_url → logo_url
          </span>
          <div className="flex items-end gap-2 rounded-xl border border-gray-200/90 bg-[#EEF1F4] px-3 pt-3">
            <span className="flex items-center gap-2 rounded-t-lg bg-white px-3 py-1.5 ring-1 ring-black/5 max-w-[16rem] min-w-0">
              {faviconSrc ? (
                <span
                  aria-hidden
                  className="w-4 h-4 rounded bg-center bg-contain bg-no-repeat shrink-0"
                  style={{ backgroundImage: `url("${faviconSrc}")` }}
                />
              ) : (
                <Utensils className="w-3.5 h-3.5 shrink-0 text-[var(--prev-primary)]" />
              )}
              <span className="text-[11px] font-bold text-gray-700 truncate">{wordmark}</span>
            </span>
            <span
              aria-hidden
              className="mb-1.5 w-4 h-4 rounded-md bg-black/5 shrink-0"
            />
          </div>
          <p className="text-[10.5px] text-gray-400 font-medium leading-snug">
            {faviconUrl.trim()
              ? 'Custom favicon in use.'
              : faviconIsFallback
                ? 'No custom favicon — your logo is used as the tab icon.'
                : 'No icon configured — the shipped TiffinOS favicon stays in place.'}
          </p>
        </div>

        {/* ── CONSOLE SIDEBAR MOCK (bg-brand-sidebar + active badge) ── */}
        <div className="rounded-2xl border border-gray-200/90 overflow-hidden bg-white">
          <div className="px-4 py-3.5 bg-[var(--prev-sidebar)] flex items-center gap-2.5">
            {logoUrl.trim() ? (
              <span
                aria-hidden
                className="w-6 h-6 rounded-md bg-white/10 bg-center bg-contain bg-no-repeat shrink-0 ring-1 ring-black/5"
                style={{ backgroundImage: `url("${logoUrl.trim()}")` }}
              />
            ) : (
              <Utensils className="w-4 h-4 shrink-0 text-[var(--prev-primary)]" />
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-black tracking-widest text-[color:var(--prev-sidebar-fg)] truncate">
                {wordmark}
              </p>
              {subline ? (
                <p className="text-[9.5px] font-medium text-[color:var(--prev-sidebar-fg-muted)] truncate">
                  {subline}
                </p>
              ) : null}
            </div>
          </div>

          <div className="bg-[var(--prev-sidebar)] px-3 py-3.5 space-y-1.5 border-t border-[color:var(--prev-sidebar-border)]">
            {/* Active nav pill → bg-brand text-white */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-bold bg-[var(--prev-primary)] text-white shadow-md shadow-black/10">
              <Users className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              <span className="truncate">Customers</span>
            </div>

            {/* Idle nav item → sidebar ink tokens */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-bold text-[color:var(--prev-sidebar-fg-soft)]">
              <Truck className="w-3.5 h-3.5 shrink-0 text-[color:var(--prev-sidebar-fg-muted)]" strokeWidth={2} />
              <span className="truncate">Deliveries</span>
            </div>

            {/* Settings group + the branding badge (bg-brand text-white sub-pill) */}
            <div className="pt-1">
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-bold text-[color:var(--prev-sidebar-fg-soft)]">
                <Settings className="w-3.5 h-3.5 shrink-0 text-[var(--prev-primary)]" strokeWidth={2} />
                <span className="truncate">Settings</span>
              </div>
              <div className="mt-1 ml-4 pl-3 border-l border-[color:var(--prev-sidebar-border)]">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold bg-[var(--prev-primary)] text-white shadow-md shadow-black/10">
                  <Palette className="w-3 h-3 shrink-0" />
                  <span className="truncate">Branding &amp; Appearance</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── BUTTONS / PILLS / FIXED SEMANTIC BADGES ── */}
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
              Primary button — bg-brand
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[var(--prev-primary)] hover:bg-[var(--prev-primary-hover)] transition-colors flex items-center gap-1.5 cursor-default select-none">
                <Check className="w-4 h-4 stroke-[3]" />
                Save Changes
              </span>
              <span className="text-[10.5px] font-mono text-gray-400">
                {ramp.primaryHex} · hover {ramp.hoverHex}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
              Brand pill — bg-brand-light text-brand
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-[10.5px] font-black uppercase tracking-wide bg-[var(--prev-primary-light)] text-[var(--prev-primary)]">
                Weekly Plan
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--prev-primary)] text-white">
                5 meals left
              </span>
              <span className="text-[10.5px] font-mono text-gray-400">tint {ramp.lightHex}</span>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-gray-100">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
              Semantic badges stay fixed
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase border bg-emerald-50 text-emerald-700 border-emerald-200">
                Veg
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase border bg-rose-50 text-rose-700 border-rose-200">
                Non-Veg
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase border bg-emerald-50 text-emerald-700 border-emerald-200">
                Active
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase border bg-amber-50 text-amber-700 border-amber-200">
                Paused
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase border bg-rose-50 text-rose-700 border-rose-200">
                Cancelled
              </span>
            </div>
            <p className="text-[10.5px] text-gray-400 font-medium leading-snug">
              Food &amp; status colours are never brand-driven, so they stay legible under every preset and
              custom accent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


