'use client';
// Bandeau hors-forfait pro — consomme /api/pro/overage-status.
// Rouge/urgent dès qu'une charge hors-forfait est passée en 'failed' (retry
// cron épuisé, voir 0020_overage_charges.sql) ; ambre sinon (overage en cours,
// informatif) — OVERAGE_GRACE=0 dans src/lib/plans-config.ts, facturé dès la
// 1ère résa hors quota, le statut 'grace_period' n'est plus jamais atteint.
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface OverageStatus {
  pending: boolean;
  urgent: boolean;
  unpaidCount: number;
  unpaidTotal: number;
  status: 'included' | 'grace_period' | 'overage';
  overageCount: number;
  currentPlanLabel: string;
  nextPlanLabel: string | null;
}

export default function OverageBanner() {
  const [data, setData] = useState<OverageStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pro/overage-status');
      if (!res.ok) return;
      const json = await res.json();
      setData(json.pending ? (json as OverageStatus) : null);
    } catch {
      // réseau — silencieux
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 60_000);
    return () => clearInterval(poll);
  }, [fetchStatus]);

  if (!data) return null;

  if (data.urgent) {
    return (
      <div className="border-b bg-red-500/10 border-red-500/20 text-red-300">
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="flex-none w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-xs font-medium flex-1 min-w-0">
            <span className="font-semibold">
              {data.unpaidCount} charge{data.unpaidCount > 1 ? 's' : ''} hors-forfait impayée{data.unpaidCount > 1 ? 's' : ''}
            </span>
            <span className="opacity-60"> · </span>
            {data.unpaidTotal.toFixed(2)}€ à régler — sera prélevé à votre prochain renouvellement
          </span>
          <Link
            href="/pro/reglages"
            className="flex-none text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white transition-colors duration-150"
          >
            Mettre à jour mon paiement →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b bg-amber-500/10 border-amber-500/20 text-amber-300">
      <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="flex-none w-2 h-2 rounded-full bg-amber-400" />
        <span className="text-xs font-medium flex-1 min-w-0">
          Vous dépassez votre quota {data.currentPlanLabel} de {data.overageCount} réservation{data.overageCount > 1 ? 's' : ''} ce mois-ci
          {data.status === 'overage' ? ' — facturé 3,99€HT/réservation au-delà du quota' : ''}
        </span>
        {data.nextPlanLabel && (
          <Link
            href="/tarifs"
            className="flex-none text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-950 transition-colors duration-150"
          >
            Passer à {data.nextPlanLabel} →
          </Link>
        )}
      </div>
    </div>
  );
}
