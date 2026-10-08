'use client';

import { useState, useTransition } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Droplet,
  Globe,
  Link2,
  Loader2,
  Moon,
  Palette,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Sun,
  Tag,
  Type,
} from 'lucide-react';
import { updateBusinessBranding } from '../../actions';
import {
  DEFAULT_BRANDING,
  THEME_PRESET_SWATCHES,
  normalizeHex,
  resolveBrandRamp,
  type BusinessBranding,
  type SidebarStyle,
  type ThemePreset,
} from '@/app/utils/branding';
import BrandingPreview from './BrandingPreview';
import BrandingUploadField from './BrandingUploadField';
import { useToast } from '@/app/components/ToastProvider';

/**
 * Settings → Branding & Appearance.
 *
 * Editor for the single `public.business_settings` row that drives the global
 * theme engine. Persists through `updateBusinessBranding` (app/admin/actions.ts),
 * which revalidates the /admin layout — so <ThemeProvider> picks the new theme up
 * and re-stamps `<html>` without a reload.
 *
 * Guardrails honoured here:
 *   • The sidebar keeps its preset surface (`bg-brand-sidebar` /
 *     `--brand-sidebar-bg`); the accent override only ever moves the primary ramp.
 *   • Semantic food/status colours (Veg=emerald, Non-Veg=rose, Active=emerald,
 *     Paused=amber, Cancelled=rose) are never brand-driven — see BrandingPreview.
 *   • The mini-preview runs on scoped CSS variables, so nothing on the live
 *     console changes until Save Changes succeeds.
 *   • Logo / favicon assets can be pasted as URLs *or* uploaded from the device
 *     (<BrandingUploadField> → Supabase Storage `branding` bucket, see
 *     app/utils/brandingUpload.ts). An upload only rewrites the form field, so it
 *     marks the form dirty exactly like typing a URL does.
 */

/** Marketing copy for the five curated presets (ids/palettes live in app/utils/branding.ts). */
const PRESET_CARDS: Record<ThemePreset, { name: string; blurb: string }> = {
  indigo: { name: 'Royal Indigo', blurb: 'Premium, restaurant-grade default' },
  saffron: { name: 'Saffron & Curry', blurb: 'Warm, spice-forward kitchen' },
  emerald: { name: 'Mint Emerald', blurb: 'Fresh & healthy meal-prep' },
  ruby: { name: 'Ruby Spice', blurb: 'Bold, high-energy brand' },
  cobalt: { name: 'Cobalt Minimal', blurb: 'Corporate catering & B2B' },
};

/**
 * Projection of the *editable* columns, with the nullable ones normalised to ''.
 *
 * Dirty state is `JSON.stringify(form) !== JSON.stringify(baseline)` over this
 * projection. Projecting instead of stringifying the rows directly keeps the
 * comparison stable: it ignores `id` / `created_at` / `updated_at` churn and any
 * column-order drift in the row that comes back from PostgREST, so a freshly
 * saved form is always pristine.
 */
const editableBranding = (row: BusinessBranding) => ({
  business_name: row.business_name,
  tagline: row.tagline ?? '',
  logo_url: row.logo_url ?? '',
  favicon_url: row.favicon_url ?? '',
  theme_preset: row.theme_preset,
  custom_primary_hex: row.custom_primary_hex ?? '',
  sidebar_style: row.sidebar_style,
});

export default function BrandingSettingsClient({
  initialBranding,
}: {
  initialBranding: BusinessBranding;
}) {
  const [form, setForm] = useState<BusinessBranding>(initialBranding);
  const [savedBaseline, setSavedBaseline] = useState<BusinessBranding>(initialBranding);
  const [hexDraft, setHexDraft] = useState(initialBranding.custom_primary_hex ?? '');
  const [isPending, startTransition] = useTransition();
  /**
   * Bottom-right floating feedback (app/components/ToastProvider.tsx). This
   * replaces the old inline `bg-emerald-50` / `bg-rose-50` banners that used to
   * be injected under the sticky header — those pushed the whole form down every
   * time a save resolved (visible layout shift).
   */
  const { showToast } = useToast();

  const isDirty =
    JSON.stringify(editableBranding(form)) !== JSON.stringify(editableBranding(savedBaseline));
  const hexInvalid = hexDraft.trim().length > 0 && !normalizeHex(hexDraft);
  const ramp = resolveBrandRamp(form.theme_preset, form.custom_primary_hex);

  /**
   * Sidebar tone options — `dark` keeps the stock console chrome, `light` flips
   * the `--brand-sidebar-*` tokens (app/globals.css). Both surfaces follow the
   * *preset*, never the custom accent, so the chrome stays legible.
   */
  const sidebarOptions: {
    id: SidebarStyle;
    name: string;
    blurb: string;
    Icon: typeof Moon;
    bg: string;
    fg: string;
  }[] = [
    {
      id: 'dark',
      name: 'Dark (default)',
      blurb: 'Stock console chrome — highest contrast for long shifts.',
      Icon: Moon,
      bg: ramp.sidebarHex,
      fg: '#FFFFFF',
    },
    {
      id: 'light',
      name: 'Light',
      blurb: 'Bright chrome for daylight kitchens and print-adjacent desks.',
      Icon: Sun,
      bg: '#F8FAFC',
      fg: '#0F1222',
    },
  ];

  const patch = (changes: Partial<BusinessBranding>) => {
    setForm(prev => ({ ...prev, ...changes }));
  };

  /** Accepts a typed or picked hex; an empty draft clears the override. */
  const handleHexChange = (raw: string) => {
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (!trimmed) {
      patch({ custom_primary_hex: null });
      return;
    }
    const normalized = normalizeHex(trimmed);
    if (normalized) patch({ custom_primary_hex: normalized });
  };

  const handleClearHex = () => {
    setHexDraft('');
    patch({ custom_primary_hex: null });
  };

  const handleSave = () => {
    if (hexInvalid) {
      showToast('Primary accent must be a 6-digit hex value, e.g. #5D5FEF.', 'error');
      return;
    }

    startTransition(async () => {
      const res = await updateBusinessBranding({
        business_name: form.business_name.trim() || DEFAULT_BRANDING.business_name,
        tagline: form.tagline,
        logo_url: form.logo_url,
        favicon_url: form.favicon_url,
        theme_preset: form.theme_preset,
        custom_primary_hex: form.custom_primary_hex,
        sidebar_style: form.sidebar_style,
      });

      if (res.success && res.branding) {
        setForm(res.branding);
        setSavedBaseline(res.branding);
        setHexDraft(res.branding.custom_primary_hex ?? '');
        showToast('Branding saved — the theme is live across the console.');
      } else {
        showToast(res.message || 'Could not save branding.', 'error');
      }
    });
  };

  /** Reverts every field to the last saved baseline (first load, or last successful save). */
  const handleReset = () => {
    setForm(savedBaseline);
    setHexDraft(savedBaseline.custom_primary_hex ?? '');
  };

  /**
   * Save-button skin. Branded + ringed the moment any field is touched, flat and
   * grey while the form matches the baseline — mirrors the `disabled` attribute.
   */
  const saveButtonClass = [
    'inline-flex items-center gap-1.5 px-5 py-2.5 font-bold text-xs rounded-xl transition-all',
    isDirty
      ? 'bg-brand hover:bg-brand-hover text-white shadow-md shadow-brand/25 ring-2 ring-brand/20 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed'
      : 'bg-gray-100 text-gray-400 cursor-not-allowed',
  ].join(' ');

  const logoUrl = (form.logo_url ?? '').trim();
  const faviconUrl = (form.favicon_url ?? '').trim();

  return (
    <div className="w-full">
      {/* ── STICKY ACTION HEADER — keeps the primary save reachable at any scroll position ── */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-brand-light text-brand flex items-center justify-center shrink-0">
              <Palette className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-[#11142D] tracking-tight truncate">
                Branding &amp; Appearance
              </h2>
              <p className="hidden sm:block text-[11px] text-gray-400 font-medium truncate">
                White-label wordmark, theme palette and console chrome.
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {/* Dirty-state indicator */}
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap ${
                isDirty ? 'text-amber-600' : 'text-gray-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isDirty ? 'bg-amber-500 animate-pulse' : 'bg-emerald-400'
                }`}
              />
              {isDirty ? 'Unsaved changes' : 'Branding is up to date'}
            </span>

            <button
              type="button"
              disabled={isPending || !isDirty}
              onClick={handleSave}
              className={saveButtonClass}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4 stroke-[3]" />
              )}
              <span>{isPending ? 'Saving…' : 'Save Changes'}</span>
            </button>
          </div>
        </div>

        {/* Save / error feedback is a bottom-right floating toast now
            (app/components/ToastProvider.tsx): nothing is injected into this
            pinned bar, so the form below never shifts when a save resolves. */}
      </div>

      {/* ── TWO-COLUMN DESKTOP LAYOUT: form (left) + sticky preview rail (right) ── */}
      <div className="mt-5 grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* ── LEFT PANE — the form inputs ── */}
        <div className="xl:col-span-7 space-y-5">

      {/* ── 1. BUSINESS IDENTITY ── */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-5 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand" />
            Business Identity
          </h3>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            The console wordmark, tagline, logo and browser-tab favicon — stored on the
            public.business_settings row.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="branding-business-name"
              className="text-xs font-bold text-gray-700 flex items-center gap-1.5"
            >
              <Type className="w-3.5 h-3.5 text-gray-400" />
              Business Name
            </label>
            <input
              id="branding-business-name"
              type="text"
              value={form.business_name}
              maxLength={60}
              onChange={e => patch({ business_name: e.target.value })}
              placeholder={DEFAULT_BRANDING.business_name}
              className="w-full px-3 py-2.5 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="branding-tagline"
              className="text-xs font-bold text-gray-700 flex items-center gap-1.5"
            >
              <Tag className="w-3.5 h-3.5 text-gray-400" />
              Tagline
            </label>
            <input
              id="branding-tagline"
              type="text"
              value={form.tagline ?? ''}
              maxLength={90}
              onChange={e => patch({ tagline: e.target.value })}
              placeholder={DEFAULT_BRANDING.tagline ?? ''}
              className="w-full px-3 py-2.5 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none transition-colors"
            />
          </div>
        </div>

        <BrandingUploadField
          id="branding-logo-url"
          label="Logo URL"
          Icon={Link2}
          value={form.logo_url ?? ''}
          onChange={value => patch({ logo_url: value })}
          placeholder="https://cdn.example.com/logo.png"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          prefix="logo"
          assetName="Logo"
        >
          <p className="text-[10.5px] text-gray-400 font-medium">
            Optional — paste a hosted URL (Supabase Storage, a CDN, any https link) or upload an image
            from your device (PNG, JPG, SVG or WEBP, max 2MB). Leave it blank to keep the wordmark text
            mark.
          </p>
        </BrandingUploadField>

        <BrandingUploadField
          id="branding-favicon-url"
          label="Custom Favicon URL / Upload"
          Icon={Globe}
          value={form.favicon_url ?? ''}
          onChange={value => patch({ favicon_url: value })}
          placeholder="https://cdn.example.com/favicon.png"
          accept="image/png,image/x-icon,image/svg+xml,image/webp"
          prefix="favicon"
          assetName="Favicon"
          fallbackValue={logoUrl}
        >
          <p className="text-[10.5px] text-gray-400 font-medium">
            Optional — leave blank to automatically use your logo as the favicon.
          </p>
          <p className="text-[10.5px] text-gray-400 font-medium">
            Paste a hosted icon or upload a PNG, ICO, SVG or WEBP file from your device (max 2MB).
          </p>
          <p className="text-[10.5px] font-medium text-gray-400">
            {faviconUrl
              ? 'Using this custom icon in the browser tab.'
              : logoUrl
                ? 'No custom icon — falling back to your logo.'
                : 'No custom icon — the default TiffinOS favicon stays in place.'}
          </p>
        </BrandingUploadField>
      </div>

      {/* ── 2. THEME PALETTE ── */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-5 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-brand" />
            Theme Palette
          </h3>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            Five curated presets. Each one repaints the primary ramp and the console sidebar surface
            (app/globals.css → <span className="font-mono">html[data-theme=&quot;…&quot;]</span>).
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Theme palette"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
        >
          {THEME_PRESET_SWATCHES.map(swatch => {
            const card = PRESET_CARDS[swatch.id];
            const selected = form.theme_preset === swatch.id;

            return (
              <button
                key={swatch.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => patch({ theme_preset: swatch.id })}
                className={`text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                  selected
                    ? 'border-brand ring-2 ring-brand/20 bg-brand-light/50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex -space-x-2" aria-hidden>
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white shadow-2xs"
                      style={{ backgroundColor: swatch.primaryHex }}
                    />
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white shadow-2xs"
                      style={{ backgroundColor: swatch.hoverHex }}
                    />
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white shadow-2xs border border-gray-200"
                      style={{ backgroundColor: swatch.lightHex }}
                    />
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white shadow-2xs"
                      style={{ backgroundColor: swatch.sidebarHex }}
                    />
                  </span>
                  {selected ? <CheckCircle2 className="w-4 h-4 text-brand shrink-0" /> : null}
                </div>

                <p className="text-xs font-black text-gray-900 mt-3">{card.name}</p>
                <p className="text-[10.5px] text-gray-400 font-medium mt-0.5">{card.blurb}</p>
                <p className="text-[10px] font-mono text-gray-400 mt-2">
                  {swatch.primaryHex} · sidebar {swatch.sidebarHex}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 3. CUSTOM COLOR OVERRIDE ── */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-5 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Droplet className="w-4 h-4 text-brand" />
            Custom Color Override
          </h3>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            Optional. Pin an exact brand hex on top of the preset — the hover shade and the light tint
            are derived for you.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="branding-accent-hex" className="text-xs font-bold text-gray-700">
            Primary accent
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick the primary accent colour"
              value={normalizeHex(hexDraft) ?? ramp.primaryHex}
              onChange={e => handleHexChange(e.target.value)}
              className="w-12 h-10 p-1 rounded-xl border border-gray-200 bg-white cursor-pointer shrink-0"
            />
            <input
              id="branding-accent-hex"
              type="text"
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              onChange={e => handleHexChange(e.target.value)}
              placeholder="#5D5FEF"
              className={`flex-1 min-w-0 px-3 py-2.5 text-xs font-mono font-bold text-gray-900 bg-white border rounded-xl outline-none transition-colors ${
                hexInvalid
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                  : 'border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/15'
              }`}
            />
            {form.custom_primary_hex ? (
              <button
                type="button"
                onClick={handleClearHex}
                className="h-10 px-3 shrink-0 rounded-xl text-[11px] font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Use preset
              </button>
            ) : null}
          </div>

          {hexInvalid ? (
            <p className="text-[10.5px] font-bold text-rose-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Enter a 6-digit hex value, e.g. #4D4FD9.
            </p>
          ) : (
            <p className="text-[10.5px] text-gray-400 font-medium">
              {form.custom_primary_hex
                ? 'Override active — this hex replaces the preset primary ramp.'
                : 'No override — the preset palette above is used as-is.'}
            </p>
          )}

          <p className="text-[10.5px] text-gray-400 font-medium leading-snug">
            The ramp this resolves to is listed in the Resolved Ramp panel in the preview rail.
          </p>
        </div>
      </div>

      {/* ── 4. SIDEBAR TONE ── */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-5 shadow-2xs">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Sun className="w-4 h-4 text-brand" />
            Sidebar Tone
          </h3>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            The console navigation surface — <span className="font-mono">bg-brand-sidebar</span> /{' '}
            <span className="font-mono">--brand-sidebar-bg</span>. Dark stays the default.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Sidebar tone"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {sidebarOptions.map(option => {
            const selected = form.sidebar_style === option.id;
            const Icon = option.Icon;

            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => patch({ sidebar_style: option.id })}
                className={`text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                  selected
                    ? 'border-brand ring-2 ring-brand/20 bg-brand-light/50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-brand" />
                    <span className="text-xs font-black text-gray-900">{option.name}</span>
                  </span>
                  {selected ? <CheckCircle2 className="w-4 h-4 text-brand shrink-0" /> : null}
                </div>

                <div
                  className="mt-3 h-14 rounded-lg overflow-hidden border border-black/5 px-2.5 py-2 space-y-1.5"
                  style={{ backgroundColor: option.bg }}
                >
                  <span
                    className="block h-2.5 w-3/5 rounded-full"
                    style={{ backgroundColor: ramp.primaryHex }}
                  />
                  <span
                    className="block h-2.5 w-2/5 rounded-full"
                    style={{ backgroundColor: option.fg, opacity: 0.24 }}
                  />
                  <span
                    className="block h-2.5 w-1/2 rounded-full"
                    style={{ backgroundColor: option.fg, opacity: 0.12 }}
                  />
                </div>

                <p className="text-[10.5px] text-gray-400 font-medium mt-2">{option.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>
        </div>

        {/* ── RIGHT PANE — sticky preview rail (xl and up) ── */}
        <div className="xl:col-span-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6.5rem)] xl:overflow-y-auto space-y-5">
          {/* ── 5. LIVE MINI-PREVIEW (unsaved state) ── */}
          <BrandingPreview
            businessName={form.business_name}
            tagline={form.tagline ?? ''}
            logoUrl={form.logo_url ?? ''}
            faviconUrl={form.favicon_url ?? ''}
            preset={form.theme_preset}
            customPrimaryHex={form.custom_primary_hex}
            sidebarStyle={form.sidebar_style}
          />

          {/* ── 6. RESOLVED RAMP SUMMARY ── */}
          <div className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Resolved Ramp
              </span>
              <span className="text-[10px] font-bold text-gray-400">
                {form.custom_primary_hex
                  ? 'Custom accent override'
                  : `${PRESET_CARDS[form.theme_preset].name} preset`}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {[
                { label: 'Primary', token: '--brand-primary', hex: ramp.primaryHex },
                { label: 'Hover', token: '--brand-primary-hover', hex: ramp.hoverHex },
                { label: 'Light tint', token: '--brand-primary-light', hex: ramp.lightHex },
                { label: 'Sidebar', token: '--brand-sidebar-bg', hex: ramp.sidebarHex },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3 py-2">
                  <span
                    className="w-5 h-5 rounded-md border border-black/5 shadow-2xs shrink-0"
                    style={{ backgroundColor: item.hex }}
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold text-gray-700 leading-tight">
                      {item.label}
                    </span>
                    <span className="block text-[9.5px] font-mono text-gray-400 truncate">
                      {item.token}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10.5px] font-mono font-bold text-gray-500">
                    {item.hex}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[10.5px] text-gray-400 font-medium leading-snug">
              The sidebar surface always follows the preset, so an accent override can never make the
              console chrome illegible.
            </p>
          </div>

          {/* ── 7. SECONDARY SAVE / RESET ── */}
          <div className="bg-white rounded-2xl border border-gray-200/90 px-5 py-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <span
              className={`text-[11px] font-bold ${isDirty ? 'text-amber-600' : 'text-gray-400'}`}
            >
              {isDirty ? '● Unsaved changes pending' : 'Branding is up to date'}
            </span>

            <div className="ml-auto flex items-center gap-2.5">
              <button
                type="button"
                disabled={isPending || !isDirty}
                onClick={handleReset}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset
              </button>

              <button
                type="button"
                disabled={isPending || !isDirty}
                onClick={handleSave}
                className={saveButtonClass}
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[3]" />
                )}
                <span>{isPending ? 'Saving…' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

