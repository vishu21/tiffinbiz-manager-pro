// Shown instantly during client-side navigation into /prep (Kitchen Prep).
// See app/admin/loading.tsx for why this shell is needed on dynamic routes.
export default function Loading() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 space-y-6 flex-1 flex flex-col min-h-0 animate-pulse" aria-busy="true" aria-label="Loading…">
      {/* Page heading */}
      <div className="h-7 w-64 rounded-md bg-gray-200" />

      {/* Metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>

      {/* Dashboard panels */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="h-80 rounded-xl border border-gray-200 bg-white" />
        <div className="h-80 rounded-xl border border-gray-200 bg-white" />
      </div>
    </div>
  );
}
