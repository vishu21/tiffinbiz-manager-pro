import { Receipt } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function BillingPage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0">
      {/* ── UNIFIED STANDARD PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200/80 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-[#11142D] tracking-tight">
              Billing &amp; Payments
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
            Track subscriber invoices, cycle renewals, cash collections, and outstanding balances.
          </p>
        </div>
      </div>

      {/* ── MAIN CONTENT CARD CONTAINER ── */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8">
          <div className="p-12 text-center border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/40">
            <Receipt className="w-9 h-9 text-gray-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-600">Billing Module Ready</p>
            <p className="text-[11px] text-gray-400 mt-1 max-w-sm mx-auto">
              Invoices, payment history, and outstanding balance collection will be managed from here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
