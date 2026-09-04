import React from "react";
import Sidebar from "@/app/components/Sidebar";

export default function PrepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F9FBFC]">
      {/* Fixed Sidebar */}
      <Sidebar />

      {/* Scrollable Main Work Area */}
      <main className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}