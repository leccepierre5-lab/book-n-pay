export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="px-4 pt-4">
        <div className="h-3 w-20 rounded bg-navy-900" />
      </div>
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-2 px-4 pt-4 pb-1 overflow-x-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex-none w-56 h-36 rounded-xl bg-navy-900 border border-white/[0.06]" />
          ))}
        </div>

        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 w-24 rounded-lg bg-navy-900 border border-white/[0.08]" />
          ))}
        </div>

        <div className="px-4 pt-6 space-y-3">
          <div className="h-5 w-2/3 rounded bg-navy-900" />
          <div className="h-24 rounded-2xl bg-navy-900 border border-white/[0.08]" />
          <div className="h-14 rounded-2xl bg-navy-900 border border-white/[0.08]" />
        </div>
      </div>
    </div>
  );
}
