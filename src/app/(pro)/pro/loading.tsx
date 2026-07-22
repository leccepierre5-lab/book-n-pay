export default function Loading() {
  return (
    <div className="min-h-dvh px-4 py-6 max-w-5xl mx-auto animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4 space-y-2">
            <div className="h-3 w-16 rounded bg-white/[0.06]" />
            <div className="h-6 w-12 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>

      <div className="h-4 w-40 rounded bg-navy-900 mb-3" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-navy-900 border border-white/[0.06]" />
        ))}
      </div>
    </div>
  );
}
