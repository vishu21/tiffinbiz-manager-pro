-- ── Branding asset bucket (direct logo / favicon uploads) ───────────────────
--
-- Settings → Branding & Appearance lets an operator either paste a hosted URL
-- or upload an image straight from their device. Uploads are written to the
-- Supabase Storage `branding` bucket by app/utils/brandingUpload.ts
-- (`uploadBrandingAsset`), which then stores the resolved public URL in
-- `public.business_settings.logo_url` / `.favicon_url`.
--
-- Bucket contract (must stay in sync with BRANDING_ASSET_MAX_BYTES in
-- app/utils/brandingUpload.ts):
--
--   public            → true, so a public URL is enough for <DynamicFavicon>
--                       and the branding previews (no signed URLs needed).
--   file_size_limit   → 2097152 bytes = 2MB, the client-side ceiling.
--   allowed_mime_types→ the formats both pickers accept:
--                         image/png, image/jpeg, image/svg+xml, image/webp,
--                         image/x-icon, image/vnd.microsoft.icon (favicons)
--
-- Idempotent — safe to re-run. Apply via the Supabase SQL editor or the CLI.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152,
  array[
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects. The console is an internal tool guarded by the
-- application layer, so this follows the same permissive pattern as
-- public.business_settings (00025) — but the policies are scoped to the
-- `branding` bucket only, so no other bucket's objects are reachable through
-- them.

drop policy if exists "Branding assets are publicly readable" on storage.objects;
create policy "Branding assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'branding');

-- `upload(..., { upsert: true })` needs both INSERT (first write) and UPDATE
-- (overwrite / same-name retry) — the field writes a timestamped name, so the
-- UPDATE branch only serves the occasional retry.
drop policy if exists "Branding assets can be uploaded" on storage.objects;
create policy "Branding assets can be uploaded"
  on storage.objects for insert
  with check (bucket_id = 'branding');

drop policy if exists "Branding assets can be replaced" on storage.objects;
create policy "Branding assets can be replaced"
  on storage.objects for update
  using (bucket_id = 'branding')
  with check (bucket_id = 'branding');

drop policy if exists "Branding assets can be removed" on storage.objects;
create policy "Branding assets can be removed"
  on storage.objects for delete
  using (bucket_id = 'branding');
