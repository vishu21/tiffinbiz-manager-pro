import type { Metadata, Viewport } from "next";
import "./globals.css";
import GlobalProgressBar from '@/app/components/ui/GlobalProgressBar';
import ThemeProvider from '@/app/components/ThemeProvider';
import ToastProvider from '@/app/components/ToastProvider';
import GlobalSkipProvider from '@/app/components/GlobalSkipProvider';
import 'nprogress/nprogress.css';
import { getBusinessBranding } from '@/app/admin/actions';
import { buildBrandStyleVars, toBrandTheme } from '@/app/utils/branding';

export const metadata: Metadata = {
  title: "Tiffin Manager OS",
  description: "Kitchen & Customer Management System",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await getBusinessBranding();

  return (
    <html
      lang="en"
      data-theme={branding.theme_preset}
      data-sidebar-style={branding.sidebar_style}
      style={buildBrandStyleVars(branding)}
      suppressHydrationWarning
    >
      <body className="min-h-screen w-full bg-[#FDFDFD] antialiased">
        <GlobalProgressBar />
        <ThemeProvider branding={branding}>
          <ToastProvider>
            <GlobalSkipProvider>
              {children}
            </GlobalSkipProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}