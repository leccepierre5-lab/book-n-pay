export default function Loading() {
  return (
    <div className="min-h-dvh">
      <div className="max-w-5xl mx-auto px-4 py-6 animate-pulse">
        <div className="h-4 w-16 rounded bg-navy-900 mb-4" />

        <div className="mb-5 space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 h-11 rounded-xl bg-navy-900 border border-white/[0.08]" />
            <div className="h-11 w-24 rounded-xl bg-navy-900" />
          </div>

          <div className="h-11 rounded-xl bg-navy-900 border border-white/[0.08]" />

          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 h-7 w-20 rounded-full bg-navy-900 border border-white/[0.08]" />
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="h-3 w-32 rounded bg-navy-900" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-navy-900 border border-white/[0.06] overflow-hidden">
              <div className="flex items-stretch">
                <div className="w-1 shrink-0 bg-white/[0.06]" />
                <div className="flex-1 p-4 flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-white/[0.06]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3.5 w-2/3 rounded bg-white/[0.06]" />
                    <div className="h-3 w-1/2 rounded bg-white/[0.06]" />
                    <div className="h-3 w-1/3 rounded bg-white/[0.06]" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
