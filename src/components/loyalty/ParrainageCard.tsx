'use client';
// src/components/loyalty/ParrainageCard.tsx
// Port de src/components/ParrainageCard.jsx — le code n'est plus dérivé
// côté client (nom+téléphone en clair) mais lu depuis app_users.referral_code,
// généré par le trigger SQL à l'inscription (plus fiable, garanti unique).
import { useState } from 'react';
import type { AppUser } from '@/lib/database.types';

export default function ParrainageCard({ profile }: { profile: AppUser }) {
  const [copied, setCopied] = useState(false);

  if (!profile.referral_code) return null;

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/inscription?ref=${profile.referral_code}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleWhatsApp = () => {
    const text = `🎁 Rejoins Book'nPay avec mon lien de parrainage et bénéficie de +5 RDV honorés offerts dès ton premier rendez-vous !\n👉 ${referralLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-600/40 bg-gradient-to-br from-amber-950 to-amber-900/40">
      <div className="flex items-center gap-2 border-b border-amber-600/20 px-4 py-3">
        <span>🎁</span>
        <p className="text-[13px] font-semibold text-white">Parrainage Sérénité</p>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-xs leading-relaxed text-white/70">
          Parrainez un ami : <strong className="text-amber-300">vous recevez tous les deux +5 RDV
          honorés</strong> et un Joker bonus dès son premier rendez-vous effectué !
        </p>

        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl bg-black/30 px-3 py-2">
            <p className="mb-0.5 text-[10px] text-white/40">Votre code</p>
            <p className="font-mono text-sm font-bold tracking-wider text-amber-300">
              {profile.referral_code}
            </p>
          </div>
          <button
            onClick={handleCopy}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
              copied ? 'border-emerald-600 bg-emerald-600' : 'border-white/20 bg-white/10 hover:bg-white/20'
            }`}
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleWhatsApp}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 py-2.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25"
          >
            WhatsApp
          </button>
          <button
            onClick={handleCopy}
            className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-semibold transition-colors ${
              copied
                ? 'border-emerald-600/40 bg-emerald-600/20 text-emerald-400'
                : 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {copied ? 'Copié !' : 'Copier le lien'}
          </button>
        </div>
      </div>
    </div>
  );
}
