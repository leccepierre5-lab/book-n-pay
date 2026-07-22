export default function Loading() {
  return (
    <div className="min-h-dvh px-4 py-6 max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-6 w-40 rounded bg-navy-900" />

      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5 space-y-3">
        <div className="h-4 w-32 rounded bg-white/[0.06]" />
        <div className="h-3 w-48 rounded bg-white/[0.06]" />
      </div>

      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-white/[0.06]" />
        ))}
      </div>
    </div>
  );
}
