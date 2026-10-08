import type { Config } from 'tailwindcss';

/**
 * TiffinOS — white-label theme engine (legacy JS config).
 *
 * The project runs Tailwind CSS v4 (`@tailwindcss/postcss` + `@import
 * "tailwindcss"` in app/globals.css), so this file is loaded through the
 * compatibility directive at the top of that stylesheet:
 *
 *     @config "../tailwind.config.ts";
 *
 * Only `theme.extend.colors.brand` lives here — everything else (base tokens,
 * the `indigo | saffron | emerald | ruby | cobalt` presets, sidebar surfaces)
 * is authored as CSS custom properties in app/globals.css.
 *
 * Source detection is intentionally left to Tailwind v4's automatic scanner
 * (no `content` key) so every dashboard/component keeps compiling exactly as
 * before. Use the `@source` directive in CSS if a path ever needs pinning.
 *
 * `brand` maps straight onto the dynamic R G B tokens (see app/globals.css):
 *   bg-brand / text-brand / border-brand        → --brand-primary
 *   bg-brand-hover                              → --brand-primary-hover
 *   bg-brand-light                              → --brand-primary-light
 *   bg-brand-sidebar                            → --brand-sidebar-bg
 * The `rgb(var(--token) / <alpha-value>)` form keeps opacity modifiers working
 * (e.g. `shadow-brand/20`, `bg-brand/10`).
 *
 * NOTE: semantic food/status colours (Veg=emerald, Non-Veg=rose, Active=emerald,
 * Paused=amber, Cancelled=rose) are deliberately NOT brand-driven and must stay
 * fixed.
 */
const config: Config = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          hover: 'rgb(var(--brand-primary-hover) / <alpha-value>)',
          light: 'rgb(var(--brand-primary-light) / <alpha-value>)',
          sidebar: 'rgb(var(--brand-sidebar-bg) / <alpha-value>)',
        },
      },
    },
  },
};

export default config;
