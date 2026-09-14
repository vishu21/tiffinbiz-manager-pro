// Shown instantly during client-side navigation into /prep (Kitchen Prep).
// See app/admin/loading.tsx for why this shell is needed on dynamic routes.
export default function Loading() {
  return (
    <div className="p-6 space-y-5 animate-pulse" aria-busy="true" aria-label="Loading…">
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
