'use client';
import { useEffect, useState } from 'react';

type Phase = 'idle' | 'loading' | 'redirecting' | 'checking' | 'done' | 'error';

export default function StepStripe({
  bizId,
  bizName,
  stripeReturn,
  stripeRefresh,
  onDone,
}: {
  bizId: string;
  bizName: string;
  stripeReturn: boolean;
  stripeRefresh: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (stripeReturn) {
      checkStatus();
    } else if (stripeRefresh) {
      startOnboarding();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkStatus = async () => {
    setPhase('checking');
    try {
      const res = await fetch('/api/stripe/connect-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bizId }),
      });
      const data = await res.json();
      if (data.onboardingComplete) {
        setPhase('done');
        setTimeout(onDone, 800);
      } else {
        // KYC non terminé, on laisse le pro relancer manuellement
        setPhase('idle');
      }
    } catch {
      setPhase('error');
      setErrorMsg('Impossible de vérifier le statut Stripe. Réessayez.');
    }
  };

  const startOnboarding = async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const returnBase = `${window.location.origin}/pro/onboarding`;
      const res = await fetch('/api/stripe/connect-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizId,
          bizName,
          returnUrl: `${returnBase}?stripe_return=1`,
          refreshUrl: `${returnBase}?stripe_refresh=1`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Erreur Stripe');
        setPhase('error');
        return;
      }
      setPhase('redirecting');
      window.location.href = data.url;
    } catch {
      setPhase('error');
      setErrorMsg('Erreur réseau');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Connectez votre compte Stripe</h2>
        <p className="mt-1 text-sm text-slate-400">
          Nécessaire pour recevoir les paiements de vos clients directement sur votre compte bancaire.
        </p>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-white">Processus sécurisé via Stripe</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Vous serez redirigé vers Stripe pour vérifier votre identité et connecter votre IBAN.
              Si vous fermez l'onglet en cours de route, vous pouvez reprendre sans perdre votre progression.
            </p>
          </div>
        </div>

        {phase === 'done' && (
          <div className="flex items-center gap-2 rounded-xl bg-mint-500/10 border border-mint-500/20 px-4 py-3">
            <svg className="w-4 h-4 text-mint-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span className="text-sm text-mint-300 font-medium">Compte Stripe connecté !</span>
          </div>
        )}

        {phase === 'checking' && (
          <p className="text-sm text-slate-400 text-center py-2">Vérification de votre compte Stripe…</p>
        )}

        {phase === 'error' && errorMsg && (
          <p className="text-xs text-red-400">{errorMsg}</p>
        )}
      </div>

      {phase !== 'done' && phase !== 'checking' && phase !== 'redirecting' && (
        <button
          onClick={startOnboarding}
          disabled={phase === 'loading'}
          className="w-full rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50 transition-colors"
        >
          {phase === 'loading' ? 'Connexion à Stripe…' : 'Connecter mon compte Stripe →'}
        </button>
      )}

      {phase === 'redirecting' && (
        <p className="text-center text-sm text-slate-400">Redirection vers Stripe…</p>
      )}
    </div>
  );
}
