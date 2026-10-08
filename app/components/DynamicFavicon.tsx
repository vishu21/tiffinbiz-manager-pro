'use client';

/**
 * DynamicFavicon — white-label browser-tab icon.
 *
 * The active kitchen can ship its own favicon (Settings → Branding). Resolution
 * priority mirrors the documented contract:
 *
 *   1. `favicon_url`  — a dedicated icon, when configured.
 *   2. `logo_url`     — the console logo, used automatically as the favicon.
 *   3. the shipped default (`app/favicon.ico`) — kept when neither is set.
 *
 * Instead of appending a second `<link rel="icon">` (two icons make the
 * browser's pick undefined), the component adopts the one the document already
 * renders — Next's file-based metadata injects `<link rel="icon"
 * href="/favicon.ico">` into `<head>` — and repoints it. Clearing the branding
 * therefore restores the original icon byte-for-byte.
 *
 * Values come from the shared client branding context (app/components/
 * ThemeProvider.tsx → `useBranding()`), which app/layout.tsx seeds from the
 * server-resolved `public.business_settings` row, so the icon updates the
 * moment branding is saved — no reload, no extra request.
 */

import { useEffect, useRef } from 'react';
import { useBranding } from '@/app/components/ThemeProvider';
import { resolveBrandFavicon } from '@/app/utils/branding';

/** `rel~="icon"` matches the plain icon link only, never `apple-touch-icon`. */
const ICON_SELECTOR = 'link[rel~="icon"]';

export default function DynamicFavicon() {
  const branding = useBranding();

  // Priority: custom favicon → configured logo → keep the shipped default.
  const href = branding ? resolveBrandFavicon(branding) : '';

  const linkRef = useRef<HTMLLinkElement | null>(null);
  const defaultHrefRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const { head } = document;

    // Adopt the document's existing icon link once (remembering its original
    // href) so restoring the default is exact; mint one only if none exists.
    let link = linkRef.current;
    if (!link || !link.isConnected) {
      link = head.querySelector<HTMLLinkElement>(ICON_SELECTOR);
      defaultHrefRef.current = link?.getAttribute('href') ?? null;
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'icon');
        head.appendChild(link);
      }
      linkRef.current = link;
    }

    if (href) {
      // Drop the shipped type/sizes hints so the browser honours the new asset
      // even when it is a different format (e.g. .svg / .png replacing .ico).
      link.removeAttribute('type');
      link.removeAttribute('sizes');
      link.setAttribute('href', href);
      return;
    }

    // Nothing configured → hand the tab back to the shipped default icon.
    const defaultHref = defaultHrefRef.current;
    if (defaultHref) {
      link.setAttribute('href', defaultHref);
    } else if (link.parentNode) {
      link.remove();
      linkRef.current = null;
    }
  }, [href]);

  return null;
}
