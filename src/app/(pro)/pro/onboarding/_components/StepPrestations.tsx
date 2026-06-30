'use client';
import { useEffect, useState } from 'react';
import type { Service } from '@/lib/database.types';
import PrestationsManager from '@/components/pro/PrestationsManager';

export default function StepPrestations({
  bizId,
  onDone,
}: {
  bizId: string;
  onDone: () => void;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/pro/services?bizId=${bizId}`)
      .then((r) => r.json())
      .then((d) => setServices(d.services ?? []))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, [bizId]);

  const handleContinue = async () => {
    setError('');
    setSubmitting(true);
    try {
      // Revalide le compte côté serveur avant d'avancer
      const res = await fetch('/api/pro/onboarding-status');
      const data = await res.json();
      if (!data.step2Done) {
        setError('Aucune prestation enregistrée. Créez-en une puis réessayez.');
        return;
      }
      onDone();
    } catch {
      setError('Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-sm">Chargement…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Vos prestations</h2>
        <p className="mt-1 text-sm text-slate-400">
          Ajoutez au moins une prestation. Vous pourrez en ajouter d'autres à tout moment depuis le dashboard.
        </p>
      </div>

      <PrestationsManager initial={services} />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handleContinue}
        disabled={submitting}
        className="w-full rounded-xl bg-mint-500 py-3 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Vérification...' : 'Continuer →'}
      </button>
    </div>
  );
}
