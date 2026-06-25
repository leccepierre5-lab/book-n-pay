export default function StepDots({ current }: { current: number }) {
  const steps = ['Prestation', 'Date & heure', 'Paiement'];
  return (
    <div className="mb-6 flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i < current
                  ? 'bg-mint-500'
                  : i === current
                  ? 'bg-mint-500 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                  : 'bg-white/10'
              }`}
            />
          </div>
          <span className={`text-[10px] font-medium transition-colors duration-200 ${
            i <= current ? 'text-mint-400' : 'text-white/25'
          }`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
