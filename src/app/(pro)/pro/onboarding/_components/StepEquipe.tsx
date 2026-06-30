'use client';
import { useState } from 'react';

export default function StepEquipe({
  bizId: _bizId,
  onSkip,
}: {
  bizId: string;
  onSkip: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const handlePublishAndSkip = async () => {
    setPublishing(true);
    setError('');
    try {
      const res = await fetch('/api/pro/publish', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Erreur lors de la publication');
        return;
      }
      onSkip();
    } catch {
      setError('Erreur réseau');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Votre équipe</h2>
        <p className="mt-1 text-sm text-slate-400">
          Si vous travaillez seul, vous pouvez publier maintenant. Vous pourrez ajouter des praticiens à tout moment depuis votre dashboard.
        </p>
      </div>

      <div className="rounded-2xl border border-mint-500/20 bg-mint-500/5 px-5 py-5">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 w-5 h-5 text-mint-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-white">Toutes les étapes obligatoires sont complètes !</p>
            <p className="mt-1 text-xs text-slate-400">
              Votre établissement sera visible et réservable par les clients dès que vous publiez.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5">
        <h3 className="text-sm font-semibold text-white mb-1">Vous avez une équipe ?</h3>
        <p className="text-xs text-slate-400 mb-4">
          Vous pourrez ajouter vos praticiens, définir leurs horaires individuels et les gérer en cas de départ depuis{' '}
          <strong className="text-white">Dashboard → Équipe</strong>.
        </p>
        <a
          href="/pro/equipe"
          className="block w-full rounded-xl border border-white/[0.08] py-2.5 text-sm text-center font-medium text-slate-300 hover:bg-white/[0.04] transition-colors"
        >
          Configurer l'équipe maintenant
        </a>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handlePublishAndSkip}
        disabled={publishing}
        className="w-full rounded-xl bg-mint-500 py-3 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors"
      >
        {publishing ? 'Publication en cours...' : 'Publier mon établissement →'}
      </button>
    </div>
  );
}
