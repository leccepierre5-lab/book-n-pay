'use client';
// src/components/pro/CaisseEncaissement.tsx
// Port de src/components/pro/CaisseEncaissement.jsx — clôture une
// prestation en choisissant comment le solde restant a été réglé sur place.
import { useState } from 'react';

interface Member {
  id: string;
  name: string;
  status: string;
  deposit: number | null;
  payment_mode: string | null;
  referrer_name?: string | null;
  referral_discount_pct?: number;
}

interface BookingForCaisse {
  id: string;
  services?: { price: number } | null;
}

const FRAIS_BNP = 1.99;
const MODE_LABEL: Record<string, string> = { app: "📱 via l'App", tpe: '💳 par TPE', especes: '💵 en Espèces' };

export default function CaisseEncaissement({
  member,
  booking,
  onValidatePresence,
}: {
  member: Member | null;
  booking: BookingForCaisse | null;
  onValidatePresence?: () => void;
}) {
  const [encaisse, setEncaisse] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmedMode, setConfirmedMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!member || !booking) return null;

  const prixOriginal = booking.services?.price || 0;
  const discountPct = member.referral_discount_pct || 0;
  const prixTotal = discountPct > 0
    ? Math.round(prixOriginal * (1 - discountPct / 100) * 100) / 100
    : prixOriginal;
  const totalPaye = member.deposit || 0;
  const includesFrais = Math.round(totalPaye * 100) % 100 === 99;
  const fraisReservation = includesFrais ? Math.round((totalPaye - FRAIS_BNP) * 100) / 100 : totalPaye;
  const solde = Math.max(0, prixTotal - fraisReservation);

  const handleCloture = async (paymentMode: string) => {
    setLoading(paymentMode);
    setError(null);
    try {
      const res = await fetch('/api/bookings/cloturer-prestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, memberId: member.id, paymentMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de la clôture');
      setConfirmedMode(paymentMode);
      setEncaisse(true);
      onValidatePresence?.();
    } catch (err: any) {
      // ⚠️ CORRECTIF (trouvé en audit) : l'erreur était seulement logguée en
      // console, jamais affichée au pro. En cas d'échec, le bouton
      // redevenait simplement cliquable sans aucune explication — le pro
      // pouvait croire que la clôture avait réussi alors que non.
      console.error('Erreur clôture:', err);
      setError(err.message || 'Une erreur est survenue, réessaie.');
    }
    setLoading(null);
  };

  if (member.status === 'arrived' || encaisse) {
    return (
      <div className="rounded-xl border border-emerald-600/30 bg-emerald-950/30 p-4 text-center">
        <p className="mb-2 text-2xl">✓</p>
        <p className="text-sm font-semibold text-emerald-400">Prestation clôturée ✅</p>
        {confirmedMode && <p className="mt-1 text-xs font-medium text-emerald-500">{MODE_LABEL[confirmedMode]}</p>}
        <p className="mt-1 text-[11px] text-white/40">
          {solde > 0 ? `Solde de ${solde}€ encaissé` : 'Prestation couverte par les frais de réservation'}
        </p>
      </div>
    );
  }

  if (member.status !== 'paid') return null;

  return (
    <div className="space-y-3 rounded-xl border-2 border-emerald-500 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-white">Console de caisse</p>

      {error && (
        <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {member.referrer_name && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-300 mb-1">
          🎁 Parrainé par <strong>{member.referrer_name}</strong>
          {discountPct > 0 && ` — réduction -${discountPct}% appliquée`}
        </div>
      )}

      <div className="space-y-1 text-sm text-white">
        <div className="flex justify-between">
          <span>Prestation{discountPct > 0 ? ` (-${discountPct}%)` : ''}</span>
          <span className="font-semibold">
            {discountPct > 0 ? (
              <><span className="line-through text-slate-500 text-xs mr-1">{prixOriginal}€</span>{prixTotal}€</>
            ) : `${prixTotal}€`}
          </span>
        </div>
        <div className="flex justify-between text-emerald-400">
          <span>Frais de réservation reçus</span>
          <span>-{fraisReservation}€</span>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold">
          <span>Solde à encaisser</span>
          <span className="text-emerald-400">{solde}€</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
          {solde > 0 ? `Comment le client règle les ${solde}€ restants ?` : 'Clôturer la prestation'}
        </p>

        <button
          onClick={() => handleCloture('app')}
          disabled={!!loading}
          className="flex w-full items-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 hover:bg-emerald-700"
        >
          <span>{loading === 'app' ? '...' : '📱'}</span>
          <div className="text-left">
            <p className="font-bold">Paiement via l'App</p>
            <p className="text-[10px] font-normal text-white/70">Lien Stripe envoyé au client</p>
          </div>
        </button>

        <button
          onClick={() => handleCloture('tpe')}
          disabled={!!loading}
          className="flex w-full items-center gap-3 rounded-xl bg-blue-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 hover:bg-blue-600"
        >
          <span>{loading === 'tpe' ? '...' : '💳'}</span>
          <div className="text-left">
            <p className="font-bold">Paiement par TPE</p>
            <p className="text-[10px] font-normal text-white/70">Terminal de paiement physique</p>
          </div>
        </button>

        <button
          onClick={() => handleCloture('especes')}
          disabled={!!loading}
          className="flex w-full items-center gap-3 rounded-xl border border-white/15 bg-navy-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 hover:bg-navy-700"
        >
          <span>{loading === 'especes' ? '...' : '💵'}</span>
          <div className="text-left">
            <p className="font-bold">Paiement en espèces</p>
            <p className="text-[10px] font-normal text-white/50">Règlement en liquide</p>
          </div>
        </button>
      </div>

      <p className="text-center text-[10px] text-white/40">
        📧 Un email de confirmation sera envoyé au client dès la clôture
      </p>
    </div>
  );
}
