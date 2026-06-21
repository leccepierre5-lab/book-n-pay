// src/components/booking/StepDots.tsx
export default function StepDots({ current }: { current: number }) {
  const steps = ['Prestation', 'Date & heure', 'Paiement'];
  return (
    <div className="mb-5 flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= current ? 'bg-mint-500' : 'bg-white/10'
            }`}
          />
        </div>
      ))}
    </div>
  );
}
