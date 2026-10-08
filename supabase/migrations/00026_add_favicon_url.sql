-- ── White-label favicon (browser tab icon) ──────────────────────────────────
--
-- Adds `favicon_url` to the single-row public.business_settings record that
-- drives the console's white-label appearance:
--
--   favicon_url → optional hosted favicon (Supabase Storage / CDN / any https
--                 link). When blank the app automatically falls back to
--                 `logo_url`, and when that is blank too the shipped default
--                 (app/favicon.ico) is kept.
--
-- Shipped as its own migration because the app must boot before this column
-- exists: app/admin/actions.ts degrades to a favicon-less save when the column
-- is missing, and normalizeBrandingRow() defaults it to null.
--
-- Idempotent — safe to re-run. Apply via the Supabase SQL editor or the CLI.

alter table public.business_settings
  add column if not exists favicon_url text;

-- Ask PostgREST to pick the new column up immediately (a stale schema cache
-- would otherwise report PGRST204 "Could not find the 'favicon_url' column").
NOTIFY pgrst, 'reload schema';
