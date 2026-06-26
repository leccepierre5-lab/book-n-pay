'use client';
import { useState } from 'react';
import type { AppUser, ReferralEvent } from '@/lib/database.types';

export default function ParrainageCard({
  profile,
  referralEvents = [],
}: {
  profile: AppUser;
  referralEvents?: ReferralEvent[];
}) {
  const [copied, setCopied] = useState(false);

  if (!profile.referral_code) return null;

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/inscription?ref=${profile.referral_code}`;
  const discountPct = profile.pending_referral_discount_pct || 0;
  const totalParrainages = referralEvents.length;
  const consumed = referralEvents.filter((e) => e.parrain_discount_consumed).length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleWhatsApp = () => {
    const text = `🎁 Rejoins Book'nPay avec mon lien de parrainage ! Tu reçois -10% sur ta prochaine prestation dès ton premier rendez-vous honoré !\n👉 ${referralLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-600/40 bg-gradient-to-br from-amber-950 to-amber-900/40">
      <div className="flex items-center gap-2 border-b border-amber-600/20 px-4 py-3">
        <span>🎁</span>
        <p className="text-[13px] font-semibold text-white">Parrainage Sérénité</p>
        {totalParrainages > 0 && (
          <span className="ml-auto text-[11px] text-amber-400 font-medium">
            {totalParrainages} parrainage{totalParrainages > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-xs leading-relaxed text-white/70">
          Parrainez un ami : vous recevez tous les deux une réduction sur votre prochaine prestation
          (<strong className="text-amber-300">-20% pour vous, -10% pour lui</strong>) dès son premier rendez-vous honoré !
        </p>

        {/* Réduction en attente */}
        {discountPct > 0 && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5">
            <p className="text-xs text-emerald-300 font-semibold">
              🎉 -{discountPct}% sur votre prochaine réservation
            </p>
            <p className="text-[10px] text-emerald-500 mt-0.5">S'applique automatiquement au prochain paiement</p>
          </div>
        )}

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

        {/* Historique */}
        {totalParrainages > 0 && (
          <div className="border-t border-white/10 pt-3 space-y-1.5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Historique</p>
            {referralEvents.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between text-xs">
                <span className="text-white/60">
                  {new Date(ev.triggered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {ev.parrain_discount_consumed ? (
                  <span className="text-slate-500">-20% utilisé</span>
                ) : (
                  <span className="text-emerald-400 font-medium">-20% en attente</span>
                )}
              </div>
            ))}
            {consumed > 0 && (
              <p className="text-[10px] text-white/30 pt-1">
                {consumed} réduction{consumed > 1 ? 's' : ''} consommée{consumed > 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
