import type { Metadata } from "next";
import "./globals.css";
import GlobalProgressBar from '@/app/components/ui/GlobalProgressBar';
import ThemeProvider from '@/app/components/ThemeProvider';
import ToastProvider from '@/app/components/ToastProvider';
import 'nprogress/nprogress.css';
import { getBusinessBranding } from '@/app/admin/actions';
import { buildBrandStyleVars, buildBrandThemeBootstrapScript, toBrandTheme } from '@/app/utils/branding';

export const metadata: Metadata = {
  title: "Tiffin Manager OS",
  description: "Kitchen & Customer Management System",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // White-label theme engine — the active branding row drives the CSS custom
  // properties declared in app/globals.css (`@layer base`) which the Tailwind
  // `brand-*` palette (tailwind.config.ts) resolves against:
  //   data-theme         → indigo | saffron | emerald | ruby | cobalt
  //   data-sidebar-style  → dark (default chrome) | light
  //   style               → inline primary-ramp override for custom_primary_hex
  //
  // The same theme is handed to <ThemeProvider> (client), which keeps <html> in
  // sync after hydration and caches it in localStorage; the inline <head> script
  // replays that cache before the first paint so a reload never flashes the
  // default preset. Only the primary ramp is dynamic — the sidebar surface and
  // the semantic food/status colours stay fixed (see app/utils/branding.ts).
  const branding = await getBusinessBranding();

  return (
    <html
      lang="en"
      data-theme={branding.theme_preset}
      data-sidebar-style={branding.sidebar_style}
      style={buildBrandStyleVars(branding)}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint hydration of the cached theme — must stay a raw <script>. */}
        <script
          dangerouslySetInnerHTML={{ __html: buildBrandThemeBootstrapScript(toBrandTheme(branding)) }}
        />
      </head>
      <body className="min-h-screen w-full bg-[#FDFDFD] antialiased">
       <GlobalProgressBar />
        <ThemeProvider branding={branding}>
          {/* Floating notification surface (see app/components/ToastProvider.tsx) —
              one instance for every route, mounted here so no page owns its own
              banner and nothing in the layout can shift when a toast fires. */}
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}