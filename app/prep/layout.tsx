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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F9FBFC] print:h-auto print:overflow-visible print:bg-white">
      <MobileHeader onMenuClick={() => setIsSidebarOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed Sidebar */}
        {/* Fixed Sidebar (hidden from the kitchen print sheet) */}
        <div className="shrink-0 print:hidden">
          <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        </div>

        {/* Scrollable Main Work Area */}
        <main className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden print:h-auto print:overflow-visible lg:ml-[260px] p-4">
          {children}
        </main>
      </div>
    </div>
  );
}