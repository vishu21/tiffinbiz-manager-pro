import React from "react";
import Sidebar from "@/app/components/Sidebar";

export default function PrepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F9FBFC] print:h-auto print:overflow-visible print:bg-white">
      {/* Fixed Sidebar */}
      {/* Fixed Sidebar (hidden from the kitchen print sheet) */}
      <div className="shrink-0 print:hidden">
        <Sidebar />
      </div>

      {/* Scrollable Main Work Area */}
      <main className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden print:h-auto print:overflow-visible">
        {children}
      </main>
    </div>
  );
}