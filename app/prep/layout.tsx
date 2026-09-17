'use client';

import React, { useState } from "react";
import Sidebar from "@/app/components/Sidebar";
import MobileHeader from "@/app/components/MobileHeader";

export default function PrepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#F9FBFC] print:h-auto print:overflow-visible print:bg-white">
      {/* Mobile Header (Hidden on tablet/desktop and print) */}
      <div className="md:hidden print:hidden shrink-0">
        <MobileHeader onMenuClick={() => setIsSidebarOpen(true)} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Sidebar Component */}
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        {/* Primary Workspace */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative print:h-auto print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}