'use client';
import { useState } from 'react';
import OnboardingProgress from './OnboardingProgress';
import StepEtablissement from './StepEtablissement';
import StepPrestations from './StepPrestations';
import StepStripe from './StepStripe';
import StepEquipe from './StepEquipe';

interface Photo { id: string; url: string; sort_order: number }

interface Props {
  bizId: string;
  bizName: string;
  initialStep: number;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  stripeReturn: boolean;
  stripeRefresh: boolean;
  business: {
    open_time: string | null;
    close_time: string | null;
    open_days: number[];
    instagram: string | null;
    facebook_url: string | null;
    website: string | null;
  };
  photos: Photo[];
}

export default function OnboardingWizard({
  bizId,
  bizName,
  initialStep,
  step1Done: s1,
  step2Done: s2,
  step3Done: s3,
  stripeReturn,
  stripeRefresh,
  business,
  photos,
}: Props) {
  const [step, setStep] = useState(initialStep);
  const [step1Done, setStep1Done] = useState(s1);
  const [step2Done, setStep2Done] = useState(s2);
  const [step3Done, setStep3Done] = useState(s3);

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-lg px-4 py-8">
        {/* En-tête */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl font-bold text-white">book</span>
            <span className="text-xl font-bold text-mint-400">n</span>
            <span className="text-xl font-bold text-white">pay</span>
          </div>
          <h1 className="text-sm text-slate-400">Configurez votre établissement</h1>
        </div>

        <OnboardingProgress
          currentStep={step}
          step1Done={step1Done}
          step2Done={step2Done}
          step3Done={step3Done}
        />

        {step === 1 && (
          <StepEtablissement
            bizName={bizName}
            initialOpenTime={business.open_time}
            initialCloseTime={business.close_time}
            initialOpenDays={business.open_days}
            initialInstagram={business.instagram}
            initialFacebook={business.facebook_url}
            initialWebsite={business.website}
            initialPhotos={photos}
            onDone={() => { setStep1Done(true); setStep(2); }}
          />
        )}

        {step === 2 && (
          <StepPrestations
            bizId={bizId}
            onDone={() => { setStep2Done(true); setStep(3); }}
          />
        )}

        {step === 3 && (
          <StepStripe
            bizId={bizId}
            bizName={bizName}
            stripeReturn={stripeReturn}
            stripeRefresh={stripeRefresh}
            onDone={() => { setStep3Done(true); setStep(4); }}
          />
        )}

        {step === 4 && (
          <StepEquipe
            bizId={bizId}
            onSkip={() => { window.location.href = '/pro'; }}
          />
        )}
      </div>
    </div>
  );
}
