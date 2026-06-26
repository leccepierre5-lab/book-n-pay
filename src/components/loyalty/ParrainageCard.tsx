'use client';
import { useState } from 'react';
import type { AppUser, EnrichedReferralEvent } from '@/lib/database.types';

export default function ParrainageCard({
  profile,
  referralEvents = [],
}: {
  profile: AppUser;
  referralEvents?: EnrichedReferralEvent[];
}) {
  const [copied, setCopied] = useState(false);

  if (!profile.referral_code) return null;

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/inscription?ref=${profile.referral_code}`;

  const discountStock = profile.referral_discounts_available || 0;
  const freeFeesStock = profile.free_management_fees_available || 0;
  const filleulDiscountPct = profile.pending_referral_discount_pct || 0;

  // Filleuls vérifiés : referral_reward_granted = true ET rdv_honores >= 1
  const verifiedEvents = referralEvents.filter(
    (e) => e.referred?.referral_reward_granted && (e.referred?.rdv_honores ?? 0) >= 1
  );
  const verifiedCount = verifiedEvents.length;

  // Progression vers le prochain palier (tous les 5 filleuls = 1 frais offert)
  const progressInTier = verifiedCount % 5;
  const tiersCompleted = Math.floor(verifiedCount / 5);
  const progressPct = progressInTier > 0 ? (progressInTier / 5) * 100 : 0;

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
        {verifiedCount > 0 && (
          <span className="ml-auto text-[11px] text-amber-400 font-medium">
            {verifiedCount} filleul{verifiedCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-xs leading-relaxed text-white/70">
          Parrainer un ami : vous recevez tous les deux une réduction
          (<strong className="text-amber-300">-20% pour vous, -10% pour lui</strong>) dès son premier rendez-vous honoré.
        </p>

        {/* Avantages en attente */}
        {(discountStock > 0 || freeFeesStock > 0 || filleulDiscountPct > 0) && (
          <div className="space-y-2">
            {discountStock > 0 && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5">
                <p className="text-xs text-emerald-300 font-semibold">
                  🎉 {discountStock} réduction{discountStock > 1 ? 's' : ''} -20% en stock
                </p>
                <p className="text-[10px] text-emerald-500 mt-0.5">
                  S'applique automatiquement à vos prochains paiements
                </p>
              </div>
            )}
            {filleulDiscountPct > 0 && discountStock === 0 && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5">
                <p className="text-xs text-emerald-300 font-semibold">
                  🎉 -{filleulDiscountPct}% sur votre prochaine réservation
                </p>
                <p className="text-[10px] text-emerald-500 mt-0.5">S'applique automatiquement au prochain paiement</p>
              </div>
            )}
            {freeFeesStock > 0 && (
              <div className="rounded-xl bg-violet-500/10 border border-violet-500/25 px-3 py-2.5">
                <p className="text-xs text-violet-300 font-semibold">
                  ✨ {freeFeesStock} frais de gestion offert{freeFeesStock > 1 ? 's' : ''}
                </p>
                <p className="text-[10px] text-violet-500 mt-0.5">
                  Cumulable avec la réduction % — s'applique automatiquement
                </p>
              </div>
            )}
          </div>
        )}

        {/* Jauge de progression vers le prochain palier */}
        {verifiedCount > 0 && (
          <div className="rounded-xl bg-black/20 border border-white/[0.06] px-3 py-2.5">
            <div className="flex justify-between items-center mb-1.5">
              <p className="text-[11px] text-white/50">
                {tiersCompleted > 0
                  ? `Prochain frais offert dans ${5 - progressInTier} filleul${5 - progressInTier > 1 ? 's' : ''}`
                  : 'Prochain frais offert'}
              </p>
              <p className="text-[11px] text-amber-400 font-medium">{progressInTier}/5</p>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {tiersCompleted > 0 && (
              <p className="text-[10px] text-white/30 mt-1">
                {tiersCompleted} palier{tiersCompleted > 1 ? 's' : ''} atteint{tiersCompleted > 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* Code + partage */}
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

        {/* Liste des filleuls confirmés */}
        {verifiedEvents.length > 0 && (
          <div className="border-t border-white/10 pt-3 space-y-1.5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Filleuls confirmés</p>
            {verifiedEvents.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between text-xs">
                <span className="text-white/70">
                  {ev.referred?.name || 'Filleul anonyme'}
                </span>
                {ev.parrain_discount_consumed ? (
                  <span className="text-slate-500">-20% utilisé</span>
                ) : (
                  <span className="text-emerald-400 font-medium">-20% en stock</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Filleuls en attente (rdv pas encore honoré) */}
        {referralEvents.length > verifiedEvents.length && (
          <div className="border-t border-white/10 pt-2">
            <p className="text-[10px] text-white/30">
              {referralEvents.length - verifiedEvents.length} filleul{referralEvents.length - verifiedEvents.length > 1 ? 's' : ''} en attente de leur premier RDV honoré
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
