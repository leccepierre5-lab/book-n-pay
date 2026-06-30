'use client';

const STEPS = [
  { label: 'Établissement' },
  { label: 'Prestations' },
  { label: 'Paiement' },
  { label: 'Équipe' },
];

export default function OnboardingProgress({
  currentStep,
  step1Done,
  step2Done,
  step3Done,
}: {
  currentStep: number;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
}) {
  const done = [step1Done, step2Done, step3Done, false];

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        {STEPS.map((s, i) => {
          const stepNum = i + 1;
          const isOptional = stepNum === 4;
          const isDone = done[i];
          const isCurrent = currentStep === stepNum;
          const isPast = currentStep > stepNum;

          return (
            <div key={stepNum} className="flex-1 flex flex-col items-center relative">
              {/* Connecteur */}
              {i < STEPS.length - 1 && (
                <div
                  className={`absolute top-4 left-1/2 w-full h-px ${
                    isDone || isPast ? 'bg-mint-500' : 'bg-white/10'
                  }`}
                  style={{ zIndex: 0 }}
                />
              )}
              {/* Cercle */}
              <div
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isDone || isPast
                    ? 'bg-mint-500 text-navy-950'
                    : isCurrent
                    ? 'bg-white text-navy-950 ring-2 ring-mint-500'
                    : 'bg-white/10 text-slate-500'
                }`}
              >
                {isDone || isPast ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              {/* Label */}
              <span
                className={`mt-1.5 text-[11px] text-center leading-tight ${
                  isCurrent ? 'text-white font-medium' : isDone || isPast ? 'text-mint-400' : 'text-slate-600'
                }`}
              >
                {s.label}
                {isOptional && (
                  <span className="block text-[10px] text-slate-600 font-normal">optionnel</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Barre de progression globale */}
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-mint-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.round(([step1Done, step2Done, step3Done].filter(Boolean).length / 3) * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500 text-right">
        {[step1Done, step2Done, step3Done].filter(Boolean).length}/3 étapes obligatoires
      </p>
    </div>
  );
}
