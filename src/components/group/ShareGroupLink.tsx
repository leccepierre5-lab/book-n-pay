'use client';
// src/components/group/ShareGroupLink.tsx
// Affiché sur la page de confirmation quand la réservation accepte
// plusieurs personnes — permet à l'organisateur de copier/partager le lien
// que ses invités utiliseront pour rejoindre et payer leur place
// (/rejoindre/[bookingId], géré par JoinGroupClient.tsx).
import { useState } from 'react';

export default function ShareGroupLink({ bookingId }: { bookingId: string }) {
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="rounded-xl border border-emerald-600/30 bg-emerald-950/30 p-4">
      <p className="mb-3 text-sm text-emerald-300">
        🎉 Invite tes amis ! Ils ont 30 minutes pour rejoindre et payer leur place.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Partager le lien
        </button>
        <button
          onClick={handleCopy}
          className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
            copied
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-white/15 text-white/60 hover:bg-white/10'
          }`}
        >
          {copied ? '✓' : 'Copier'}
        </button>
      </div>
    </div>
  );
}
