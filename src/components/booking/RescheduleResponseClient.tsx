'use client';
// src/components/booking/RescheduleResponseClient.tsx
// Page publique /reschedule/[token] — le client consulte et répond à une
// proposition de report envoyée par le pro (migration 0055). Le lien est le
// seul facteur d'accès (token haute entropie, voir generateRescheduleToken) :
// aucune connexion requise. Ne modifie jamais rien tant que le client n'a
// pas explicitement cliqué "Accepter" ou "Refuser".
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatTime } from '@/lib/booking-utils';

type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'slot_taken';

interface ProposalData {
  status: ProposalStatus;
  bizName: string | null;
  serviceName: string | null;
  originalDate: string;
  originalTime: string;
  proposedDate: string;
  proposedTime: string;
  reason: string | null;
  expiresAt: string;
}

function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatTimeFr(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// Date claire en priorité (fiable même si la page reste ouverte des heures) —
// complétée par un délai relatif seulement s'il est court, où compter à la
// tête peut faire rater l'échéance (demande explicite : pas de calcul mental
// pour quelqu'un qui ouvre ça sur son téléphone dans le métro).
function formatDeadline(expiresAt: Date, now: Date): { clear: string; short: string | null } {
  const diffMs = expiresAt.getTime() - now.getTime();
  if (diffMs <= 0) return { clear: 'Le délai pour répondre est dépassé.', short: null };

  const sameDay = expiresAt.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = expiresAt.toDateString() === tomorrow.toDateString();
  const timeStr = formatTimeFr(expiresAt);

  let clear: string;
  if (sameDay) clear = `Vous avez jusqu'à aujourd'hui ${timeStr} pour répondre.`;
  else if (isTomorrow) clear = `Vous avez jusqu'à demain ${timeStr} pour répondre.`;
  else {
    const dateStr = expiresAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    clear = `Vous avez jusqu'au ${dateStr} à ${timeStr} pour répondre.`;
  }

  const diffHours = diffMs / (1000 * 60 * 60);
  let short: string | null = null;
  if (diffHours < 6) {
    const wholeHours = Math.floor(diffHours);
    const mins = Math.round((diffHours - wholeHours) * 60);
    short = wholeHours > 0 ? `Il reste environ ${wholeHours} h${mins > 0 ? ` ${mins} min` : ''}.` : `Il reste environ ${mins} min.`;
  }
  return { clear, short };
}

export default function RescheduleResponseClient({ token }: { token: string }) {
  const [data, setData] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const res = await fetch(`/api/bookings/reschedule?token=${encodeURIComponent(token)}`);
    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error || 'Lien invalide.');
      setData(null);
    } else {
      setLoadError(null);
      setData(json);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Recalcule le délai affiché pendant que la page reste ouverte — la date
  // claire ne bouge pas, seul le "il reste environ..." se rafraîchit.
  useEffect(() => {
    if (!data || data.status !== 'pending') return;
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, [data]);

  const respond = async (action: 'accept' | 'decline') => {
    setSubmitting(action);
    setActionError(null);
    const res = await fetch(`/api/bookings/reschedule/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    setSubmitting(null);
    if (!res.ok) {
      // slot_taken / expired renvoyés par l'API avec le nouveau statut —
      // même sans succès HTTP, c'est un état affichable, pas juste une erreur.
      if (json.status) {
        setData((prev) => (prev ? { ...prev, status: json.status } : prev));
      } else {
        setActionError(json.error || "L'action a échoué, réessaie.");
      }
      return;
    }
    await load();
  };

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-white/40">Chargement...</div>;
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 text-center">
        <p className="text-white/60">{loadError || 'Ce lien de report est introuvable ou a expiré.'}</p>
      </div>
    );
  }

  const deadline = formatDeadline(new Date(data.expiresAt), now);

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-md">
        <Link href="/" className="mb-5 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Accueil
        </Link>

        <div className="mb-5 text-center">
          <h1 className="text-lg font-semibold text-white">{data.bizName || 'Votre rendez-vous'}</h1>
          {data.serviceName && <p className="text-sm text-white/60">{data.serviceName}</p>}
        </div>

        {data.status === 'pending' && (
          <>
            <div className="mb-4 rounded-xl bg-navy-900 p-4">
              <p className="mb-1 text-[11px] font-medium text-white/40">Créneau actuel</p>
              <p className="mb-3 text-sm text-white/50 line-through decoration-white/30">
                {formatDateFr(data.originalDate)} à {formatTime(data.originalTime)}
              </p>
              <p className="mb-1 text-[11px] font-medium text-sky-400">Nouveau créneau proposé</p>
              <p className="text-base font-semibold text-white">
                {formatDateFr(data.proposedDate)} à {formatTime(data.proposedTime)}
              </p>
              {data.reason && <p className="mt-3 text-xs text-white/50">Motif : {data.reason}</p>}
            </div>

            <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-center">
              <p className="text-sm font-medium text-amber-300">{deadline.clear}</p>
              {deadline.short && <p className="mt-1 text-xs text-amber-300/70">{deadline.short}</p>}
            </div>

            {actionError && <p className="mb-4 text-center text-xs text-red-400">{actionError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => respond('decline')}
                disabled={submitting !== null}
                className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                {submitting === 'decline' ? 'Envoi...' : 'Refuser'}
              </button>
              <button
                onClick={() => respond('accept')}
                disabled={submitting !== null}
                className="flex-1 rounded-xl bg-mint-500 py-3 text-sm font-medium text-navy-950 disabled:opacity-50"
              >
                {submitting === 'accept' ? 'Envoi...' : 'Accepter'}
              </button>
            </div>
          </>
        )}

        {data.status === 'accepted' && (
          <div className="rounded-xl bg-navy-900 p-5 text-center">
            <p className="mb-2 text-2xl">✅</p>
            <p className="mb-1 text-sm font-medium text-white">Report confirmé</p>
            <p className="text-sm text-white/60">
              Votre RDV est maintenant le {formatDateFr(data.proposedDate)} à {formatTime(data.proposedTime)}.
            </p>
          </div>
        )}

        {data.status === 'declined' && (
          <div className="rounded-xl bg-navy-900 p-5 text-center">
            <p className="mb-1 text-sm font-medium text-white">Report refusé</p>
            <p className="text-sm text-white/60">
              Votre RDV reste au {formatDateFr(data.originalDate)} à {formatTime(data.originalTime)}.
            </p>
          </div>
        )}

        {data.status === 'expired' && (
          <div className="rounded-xl bg-navy-900 p-5 text-center">
            <p className="mb-1 text-sm font-medium text-white">Délai dépassé</p>
            <p className="text-sm text-white/60">
              Vous n&apos;avez pas répondu à temps. Votre RDV reste au {formatDateFr(data.originalDate)} à{' '}
              {formatTime(data.originalTime)}.
            </p>
          </div>
        )}

        {data.status === 'slot_taken' && (
          <div className="rounded-xl bg-navy-900 p-5 text-center">
            <p className="mb-1 text-sm font-medium text-white">Créneau indisponible</p>
            <p className="text-sm text-white/60">
              Ce créneau vient d&apos;être pris entre-temps. Le professionnel va vous recontacter — votre RDV reste
              au {formatDateFr(data.originalDate)} à {formatTime(data.originalTime)} pour le moment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
