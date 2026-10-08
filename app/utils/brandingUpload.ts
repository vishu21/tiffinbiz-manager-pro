/**
 * Direct branding-asset uploads (Settings → Branding & Appearance).
 *
 * The Logo / Favicon fields on the branding screen accept either a pasted URL
 * or a file picked straight from the operator's device. Picked files land in the
 * Supabase Storage `branding` bucket and the public URL is written back into the
 * form field — the same `logo_url` / `favicon_url` columns of
 * `public.business_settings` that any pasted CDN link would use, so nothing
 * downstream (`app/layout.tsx`, <DynamicFavicon>, the mini-preview) needs to
 * know an upload happened.
 *
 * Contract:
 *   • Bucket   — `branding`, created/kept by supabase/migrations/
 *                00027_add_branding_storage_bucket.sql (public read, 2MB cap).
 *   • Path     — `<prefix>-<timestamp>.<ext>` → the newest upload wins for the
 *                current session; `upsert: true` keeps a flaky retry quiet.
 *   • Limit    — 2MB per asset, mirrored by the bucket's `file_size_limit`.
 *
 * This module is safe to import from client components only (it reaches for the
 * browser Supabase client through a dynamic import, mirroring the existing
 * pattern in `CustomerSplitLayout` / `DeliveriesClient` / `PrepDashboardClient`)
 * — that keeps the browser client out of any server bundle and avoids a
 * needless circular trip through the SSR cookie plumbing.
 */

/** The Supabase Storage bucket that holds uploaded logos & favicons. */
export const BRANDING_BUCKET = 'branding';

/** Hard ceiling for a single asset (2MB) — mirrored by the bucket's file_size_limit. */
export const BRANDING_ASSET_MAX_BYTES = 2 * 1024 * 1024;

/** Path namespace inside the bucket — also the filename prefix. */
export type BrandingAssetPrefix = 'logo' | 'favicon';

/** True when the picked file blows past the 2MB ceiling (pre-flight, before the network call). */
export function isBrandingAssetTooLarge(file: File): boolean {
  return file.size > BRANDING_ASSET_MAX_BYTES;
}

/**
 * Uploads one branding asset to Supabase Storage and resolves with its public URL.
 *
 * @param file   The picked image (validated for size by the caller/`isBrandingAssetTooLarge`).
 * @param prefix `logo` | `favicon` — keeps the two assets apart in the bucket.
 * @throws The Supabase StorageError (or any transport error) so callers can toast it.
 */
export async function uploadBrandingAsset(
  file: File,
  prefix: BrandingAssetPrefix
): Promise<string> {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = /^[a-z0-9]+$/i.test(rawExt) ? rawExt.toLowerCase() : 'png';
  const filePath = `${prefix}-${Date.now()}.${ext}`;

  const { createClient } = await import('@/utils/supabase/client');
  const supabase = createClient();

  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(filePath, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}
