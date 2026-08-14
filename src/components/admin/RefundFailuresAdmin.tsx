'use client';
// src/components/admin/RefundFailuresAdmin.tsx
// Migration 0052 — remplace la promesse creuse "vérification manuelle" par
// une vraie file : chaque échec de remboursement (des 4 routes concernées)
// atterrit ici tant qu'un admin n'a pas relancé ou résolu manuellement.
import { useState } from 'react';
import Link from 'next/link';
import type { RefundFailureWithBooking } from '@/lib/database.types';

export default function RefundFailuresAdmin({
  failures,
}: {
  failures: RefundFailureWithBooking[];
}) {
  const [local, setLocal] = useState(failures);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const retry = async (id: string) => {
    setRetrying(id);
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    const res = await fetch(`/api/admin/refund-failures/${id}/retry`, { method: 'POST' });
    if (res.ok) {
      setLocal((prev) => prev.filter((f) => f.id !== id));
    } else {
      const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      setErrorById((prev) => ({ ...prev, [id]: d.error ?? 'Erreur serveur' }));
    }
    setRetrying(null);
  };

  const resolveManually = async (id: string) => {
    const note = window.prompt(
      'Note de résolution (obligatoire) — ex. "Remboursé manuellement via virement le 14/08" :'
    );
    if (!note || !note.trim()) return;

    setResolving(id);
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    const res = await fetch(`/api/admin/refund-failures/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (res.ok) {
      setLocal((prev) => prev.filter((f) => f.id !== id));
    } else {
      const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      setErrorById((prev) => ({ ...prev, [id]: d.error ?? 'Erreur serveur' }));
    }
    setResolving(null);
  };

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/admin" className="text-white/60 hover:text-white">
            ←
          </Link>
          <h1 className="text-lg font-semibold text-white">Remboursements en échec</h1>
        </div>

        {local.length === 0 ? (
          <p className="rounded-xl bg-navy-900 p-4 text-sm text-white/50">
            Aucun remboursement en échec ouvert. 🎉
          </p>
        ) : (
          <div className="space-y-3">
            {local.map((f) => {
              const booking = f.bookings;
              const dateFormatted = booking
                ? new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
                    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                  })
                : null;

              return (
                <div key={f.id} className="rounded-xl bg-navy-900 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {(f.amount_cents / 100).toFixed(2)}€
                        {booking && <span className="text-white/50"> — {booking.service_name}</span>}
                      </p>
                      {booking && (
                        <p className="text-xs text-white/50">
                          {booking.biz_name} · {dateFormatted} à {booking.time?.slice(0, 5)}
                          {booking.client_email && <> · {booking.client_email}</>}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-white/30">
                        booking {f.booking_id} · {f.attempts} tentative{f.attempts > 1 ? 's' : ''} ·
                        {' '}{new Date(f.created_at).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  </div>

                  <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {f.error_message}
                  </p>

                  {errorById[f.id] && (
                    <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                      Échec de l'action : {errorById[f.id]}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => retry(f.id)}
                      disabled={retrying === f.id || resolving === f.id}
                      className="rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-semibold text-navy-950 disabled:opacity-50"
                    >
                      {retrying === f.id ? 'Relance…' : 'Relancer le remboursement'}
                    </button>
                    <button
                      onClick={() => resolveManually(f.id)}
                      disabled={retrying === f.id || resolving === f.id}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
                    >
                      {resolving === f.id ? 'Résolution…' : 'Résolution manuelle'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
