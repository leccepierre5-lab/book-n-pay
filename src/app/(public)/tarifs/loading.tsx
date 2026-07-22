export default function Loading() {
  return (
    <div className="min-h-dvh px-4 py-10 animate-pulse">
      <div className="mx-auto max-w-5xl">
        <div className="h-4 w-16 rounded bg-navy-900 mb-8" />

        <div className="mb-12 flex flex-col items-center gap-3">
          <div className="h-3 w-24 rounded bg-navy-900" />
          <div className="h-7 w-full max-w-md rounded bg-navy-900" />
          <div className="h-3 w-full max-w-lg rounded bg-navy-900" />
        </div>

        <div className="mb-16 grid gap-5 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/[0.08] bg-navy-900 p-6 min-h-[380px] space-y-4">
              <div className="h-5 w-24 rounded-full bg-white/[0.06]" />
              <div className="h-5 w-16 rounded bg-white/[0.06]" />
              <div className="h-9 w-28 rounded bg-white/[0.06]" />
              <div className="space-y-2 pt-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-3 w-full rounded bg-white/[0.06]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
