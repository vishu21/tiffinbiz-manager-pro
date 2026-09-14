// Shown instantly during client-side navigation to any /admin tab (Customers,
// Deliveries, Overview). Because it lives above the data-fetching pages,
// Next.js prefetches this shell for dynamic routes, so tab switches give
// immediate visual feedback while the real page content streams in.
export default function Loading() {
  return (
    <div className="p-6 space-y-4 animate-pulse" aria-busy="true" aria-label="Loading…">
      {/* Page heading + primary action */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-56 rounded-md bg-gray-200" />
        <div className="h-9 w-32 rounded-lg bg-gray-200" />
      </div>

      {/* Toolbar / search */}
      <div className="h-10 w-full max-w-sm rounded-lg bg-gray-200" />

      {/* Table shell */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="h-11 border-b border-gray-200 bg-gray-50" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-gray-100 px-4 py-3.5"
          >
            <div className="h-3 w-1/4 rounded bg-gray-200" />
            <div className="h-3 w-1/5 rounded bg-gray-200" />
            <div className="ml-auto h-3 w-16 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
