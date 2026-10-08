-- ── White-label branding & global theme engine ──────────────────────────────
--
-- Single-row configuration table that drives TiffinOS' white-label appearance:
--
--   business_name       → console wordmark (default 'TiffinOS')
--   tagline             → secondary line under the wordmark
--   logo_url            → optional hosted logo (Supabase Storage / CDN)
--   favicon_url         → optional hosted browser-tab icon; falls back to
--                         logo_url, then to the shipped app/favicon.ico
--                         (added by 00026_add_favicon_url.sql)
--   theme_preset        → brand preset key resolved by app/globals.css through
--                         html[data-theme="…"]:
--                           indigo | saffron | emerald | ruby | cobalt
--   custom_primary_hex  → optional #RRGGBB override for the primary ramp;
--                         stamped inline on <html> by app/layout.tsx so it wins
--                         over the preset
--   sidebar_style       → dark (stock console chrome) | light
--
-- Read/written by app/admin/actions.ts (getBusinessBranding /
-- updateBusinessBranding) and consumed by app/layout.tsx + app/components/.
--
-- Idempotent — safe to re-run. Apply via the Supabase SQL editor or the CLI.

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text not null default 'TiffinOS',
  tagline text default 'Commercial Kitchen & Meal-Prep Operating System',
  logo_url text,
  favicon_url text,
  theme_preset text not null default 'indigo',
  custom_primary_hex text,
  sidebar_style text not null default 'dark',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Guard rails — only the shipped presets / sidebar surfaces may be stored. The
-- runtime normalizes unexpected values anyway (app/utils/branding.ts); this just
-- keeps the table honest for future multi-tenant tooling.
alter table public.business_settings
  drop constraint if exists business_settings_theme_preset_check;
alter table public.business_settings
  add constraint business_settings_theme_preset_check
  check (theme_preset in ('indigo', 'saffron', 'emerald', 'ruby', 'cobalt'));

alter table public.business_settings
  drop constraint if exists business_settings_sidebar_style_check;
alter table public.business_settings
  add constraint business_settings_sidebar_style_check
  check (sidebar_style in ('dark', 'light'));

-- Seed the single branding row so the console never renders unbranded. The
-- server action also lazily creates this row if the table was emptied.
insert into public.business_settings (business_name, tagline, theme_preset, sidebar_style)
select 'TiffinOS', 'Commercial Kitchen & Meal-Prep Operating System', 'indigo', 'dark'
where not exists (select 1 from public.business_settings);

-- RLS: the console is an internal tool guarded by the application layer, so this
-- table follows the same permissive pattern as recipes / daily_menu_selections.
alter table public.business_settings enable row level security;

drop policy if exists "Public access to business_settings" on public.business_settings;
create policy "Public access to business_settings"
  on public.business_settings for all
  using (true)
  with check (true);

-- Keep updated_at authoritative even when a row is touched outside the app
-- (the server action also sets it explicitly, mirroring app_settings).
create or replace function public.touch_business_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_business_settings_updated_at on public.business_settings;
create trigger trg_business_settings_updated_at
  before update on public.business_settings
  for each row
  execute function public.touch_business_settings_updated_at();

-- Ask PostgREST to pick up the new table immediately (a stale schema cache would
-- otherwise report PGRST205 "Could not find the table").
NOTIFY pgrst, 'reload schema';
