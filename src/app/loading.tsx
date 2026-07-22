export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh gap-7 px-4 animate-pulse">
      <div className="w-20 h-20 rounded-2xl bg-navy-900" />
      <div className="flex flex-col items-center gap-3">
        <div className="h-4 w-44 rounded bg-navy-900" />
        <div className="h-3 w-60 rounded bg-navy-900" />
      </div>
      <div className="w-full max-w-sm h-14 rounded-2xl bg-navy-900" />
    </div>
  );
}
