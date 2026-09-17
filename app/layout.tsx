import type { Metadata } from "next";
import "./globals.css";
import GlobalProgressBar from '@/app/components/ui/GlobalProgressBar';
import 'nprogress/nprogress.css';

export const metadata: Metadata = {
  title: "Tiffin Manager OS",
  description: "Kitchen & Customer Management System",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen w-full bg-[#FDFDFD] antialiased">
       <GlobalProgressBar />
        {children}
      </body>
    </html>
  );
}