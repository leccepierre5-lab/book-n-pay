'use client';
// src/components/group/ShareGroupLink.tsx
// Affiché sur la page de confirmation quand la réservation accepte
// plusieurs personnes — permet à l'organisateur de copier/partager le lien
// que ses invités utiliseront pour rejoindre et payer leur place
// (/rejoindre/[bookingId], géré par JoinGroupClient.tsx).
import { useState, useEffect } from 'react';

export default function ShareGroupLink({ bookingId }: { bookingId: string }) {
  const [copied, setCopied] = useState(false);
  // Déterminé après montage (pas au premier rendu serveur, où `navigator`
  // n'existe pas) — évite un mismatch d'hydratation entre le HTML SSR et le
  // premier rendu client.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => { setCanNativeShare(!!navigator.share); }, []);

  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/rejoindre/${bookingId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: "Rejoins ma réservation Book'nPay", url: link }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  // Construits au clic (pas au rendu, voir ShareGuestLinks.tsx pour le
  // détail du piège SSR/origin) — sans numéro = wa.me ouvre le sélecteur de
  // contacts WhatsApp, adapté à "invite tes amis" (pas un contact précis).
  const handleWhatsapp = () => {
    const message = `Rejoins ma réservation Book'nPay : ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };
  const handleEmail = () => {
    const message = `Rejoins ma réservation Book'nPay : ${link}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("Rejoins ma réservation Book'nPay")}&body=${encodeURIComponent(message)}`;
  };

  return (
    <div className="rounded-xl border border-emerald-600/30 bg-emerald-950/30 p-4">
      <p className="mb-3 text-sm text-emerald-300">
        🎉 Invite tes amis ! Ils ont 30 minutes pour rejoindre et payer leur place.
      </p>
      <div className="flex gap-2 mb-2">
        {canNativeShare && (
          <button
            onClick={handleShare}
            className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Partager le lien
          </button>
        )}
        <button
          onClick={handleCopy}
          className={`flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
            copied
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-white/15 text-white/60 hover:bg-white/10'
          }`}
        >
          {copied ? '✓ Copié' : 'Copier le lien'}
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleWhatsapp}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 transition-colors"
        >
          WhatsApp
        </button>
        <button
          onClick={handleEmail}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 transition-colors"
        >
          Email
        </button>
      </div>
    </div>
  );
}
