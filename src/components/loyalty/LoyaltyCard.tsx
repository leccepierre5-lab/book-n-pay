'use client';
import { useState } from 'react';
import type { AppUser } from '@/lib/database.types';
import { TIERS } from '@/lib/booking-utils';

const TIER_ICON: Record<string, string> = { Bronze: '🥉', Argent: '🥈', Gold: '🏆' };

function Sphere({ statut, className = '' }: { statut: string; className?: string }) {
  if (statut !== 'Standard') {
    return <span className={`leading-none ${className}`}>{TIER_ICON[statut] ?? '⭐'}</span>;
  }
  return (
    <div
      className={`rounded-full flex-shrink-0 ${className}`}
      style={{
        background: 'radial-gradient(circle at 33% 33%, #ffffff 0%, #d0d0d0 55%, #a0a0a0 100%)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.45), inset 0 1px 3px rgba(255,255,255,0.7)',
      }}
    />
  );
}

function LoyaltyModal({ profile, onClose }: { profile: AppUser; onClose: () => void }) {
  const rdv = profile.rdv_honores || 0;
  const statut = profile.statut || 'Standard';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-[#111827] border-t border-white/[0.08] p-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-base">☆</span>
            <p className="font-bold text-white text-base">Book'nPay Sérénité</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Current status */}
        <div className="flex flex-col items-center mb-6">
          <p className="text-xs text-slate-500 mb-3">Votre statut actuel</p>
          {statut === 'Standard' ? (
            <Sphere statut="Standard" className="w-10 h-10" />
          ) : (
            <span className="text-4xl">{TIER_ICON[statut]}</span>
          )}
          <p className="text-xl font-bold text-white mt-2">{statut}</p>
          <p className="text-xs text-slate-500 mt-0.5">{rdv} RDV honorés au total</p>
        </div>

        {/* Tier list */}
        <div className="space-y-2 mb-4">
          {TIERS.map((tier) => {
            const isActive = statut === tier.key;
            return (
              <div
                key={tier.key}
                className={`rounded-xl px-4 py-3 flex items-center gap-3 ${
                  isActive
                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                    : 'bg-white/[0.04] border border-white/[0.06]'
                }`}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  {tier.key === 'Standard' ? (
                    <Sphere statut="Standard" className="w-6 h-6" />
                  ) : (
                    <span className="text-xl">{TIER_ICON[tier.key]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isActive ? 'text-emerald-400' : 'text-white'}`}>
                    {tier.key}
                  </p>
                  <p className="text-[11px] text-slate-500">à partir de {tier.rdv} RDV</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-white">
                    {tier.jokers} Joker{tier.jokers > 1 ? 's' : ''}
                  </p>
                  <p className="text-[11px] text-slate-500">{tier.pct}% remboursé</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Inactivity warning */}
        <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-4 py-3 flex items-start gap-2">
          <span className="text-red-400 mt-0.5 shrink-0 text-sm">🛡</span>
          <p className="text-xs text-red-300 leading-relaxed">
            <strong>Règle d'inactivité :</strong> En cas d'absence de réservation honorée pendant{' '}
            <strong>2 mois consécutifs</strong>, votre statut sera automatiquement réinitialisé à Standard
            et vos Jokers non utilisés seront perdus.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoyaltyCard({ profile }: { profile: AppUser }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState<(typeof TIERS)[number]['key'] | null>(null);

  const rdv = profile.rdv_honores || 0;
  const statut = profile.statut || 'Standard';
  const jokersDispo = profile.jokers_disponibles ?? 0;
  const jokersUtilises = profile.jokers_utilises ?? 0;
  const remboursementPct = 100;

  const currentTierIdx = TIERS.findIndex((t) => t.key === statut);
  const nextTier = currentTierIdx < TIERS.length - 1 ? TIERS[currentTierIdx + 1] : null;
  const currentTierRdv = TIERS[currentTierIdx]?.rdv ?? 0;
  const progressMax = nextTier?.rdv ?? TIERS[TIERS.length - 1].rdv;
  const progressPct = nextTier
    ? Math.round(((rdv - currentTierRdv) / (nextTier.rdv - currentTierRdv)) * 100)
    : 100;

  // Détail du palier cliqué — généralise la progression "vers le palier
  // suivant" à N'IMPORTE QUEL palier cliqué (pas seulement le prochain).
  // Garde essentielle : un palier est "achieved" dès que rdv >= tier.rdv,
  // ce qui couvre à la fois un palier déjà dépassé ET le cas Gold cliqué
  // alors qu'il est déjà le statut courant (pas de palier suivant à viser,
  // donc pas de calcul "reste X rendez-vous" à faire sur lui).
  const selected = selectedTier ? TIERS.find((t) => t.key === selectedTier) ?? null : null;
  const selectedAchieved = selected ? rdv >= selected.rdv : false;
  const selectedRdvToGo = selected && !selectedAchieved ? selected.rdv - rdv : 0;
  const selectedJokersGagnes =
    selected && !selectedAchieved ? selected.jokers - (TIERS[currentTierIdx]?.jokers ?? 0) : 0;
  const selectedProgressPct =
    selected && !selectedAchieved
      ? Math.round(((rdv - currentTierRdv) / (selected.rdv - currentTierRdv)) * 100)
      : 100;

  return (
    <>
      {showModal && <LoyaltyModal profile={profile} onClose={() => setShowModal(false)} />}

      {/* Main loyalty card */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden mb-4">
        {/* Row 1: sphere + statut + rdv count */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            {statut === 'Standard' ? (
              <Sphere statut="Standard" className="w-8 h-8" />
            ) : (
              <span className="text-3xl leading-none">{TIER_ICON[statut]}</span>
            )}
            <div>
              <p className="text-sm font-bold text-white">Statut {statut}</p>
              <p className="text-[11px] text-slate-500">Book'nPay Sérénité</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">RDV honorés</p>
              <p className="text-3xl font-bold text-white leading-tight">{rdv}</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              aria-label="Voir le détail du programme Book'nPay Sérénité"
              className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/15 transition-colors text-[11px] font-bold"
            >
              ⓘ
            </button>
          </div>
        </div>

        <div className="h-px bg-white/[0.05] mx-4" />

        {/* Row 2: jokers + remboursement */}
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-[11px] text-slate-500 mb-2">
              Jokers disponibles ({jokersUtilises}/{jokersDispo + jokersUtilises} utilisés)
            </p>
            <div className="flex gap-1.5">
              {Array.from({ length: jokersDispo + jokersUtilises }).map((_, i) => (
                <div
                  key={i}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm border ${
                    i < jokersUtilises
                      ? 'border-white/10 bg-white/5 opacity-30'
                      : 'border-emerald-500/30 bg-emerald-500/10'
                  }`}
                >
                  🃏
                </div>
              ))}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-500">Remboursement</p>
            <p className="text-2xl font-bold text-emerald-400">{remboursementPct}%</p>
          </div>
        </div>

        {/* Row 3: progress bar */}
        <div className="px-4 pb-3">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
            <span>{statut}</span>
            {nextTier && <span>{nextTier.key} à {nextTier.rdv} RDV</span>}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(2, progressPct)}%`,
                background: 'linear-gradient(90deg, #34d399, #6ee7b7)',
              }}
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-1.5 text-right">
            {rdv}/{progressMax} RDV honorés
          </p>
        </div>

        <div className="h-px bg-white/[0.05] mx-4" />

        {/* Row 4: tier icons — cliquables, affichent le détail du palier ci-dessous */}
        <div className="grid grid-cols-4 gap-1 px-3 py-3">
          {TIERS.map((tier) => {
            const isActive = statut === tier.key;
            const isSelected = selectedTier === tier.key;
            return (
              <button
                key={tier.key}
                type="button"
                onClick={() => setSelectedTier((cur) => (cur === tier.key ? null : tier.key))}
                aria-pressed={isSelected}
                className={`flex flex-col items-center gap-1 rounded-xl py-2 transition-colors hover:bg-white/5 ${
                  isActive ? 'bg-emerald-500/10 border border-emerald-500/25' : ''
                } ${isSelected ? 'ring-1 ring-emerald-400/50' : ''}`}
              >
                <div className="w-7 h-7 flex items-center justify-center">
                  {tier.key === 'Standard' ? (
                    <Sphere statut="Standard" className="w-5 h-5" />
                  ) : (
                    <span className="text-[18px] leading-none">{TIER_ICON[tier.key]}</span>
                  )}
                </div>
                <p className={`text-[10px] font-medium ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {tier.key}
                </p>
              </button>
            );
          })}
        </div>

        {/* Détail du palier cliqué */}
        {selected && (
          <div className="px-4 pb-4">
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg leading-none">
                  {selected.key === 'Standard' ? '⚪' : TIER_ICON[selected.key]}
                </span>
                <p className="text-sm font-semibold text-white">{selected.key}</p>
                {selectedAchieved && (
                  <span className="text-[10px] text-emerald-400 font-medium ml-auto">Palier atteint</span>
                )}
              </div>

              <p className="text-[11px] text-slate-400 mb-2">
                {selected.jokers} Joker{selected.jokers > 1 ? 's' : ''} annuel
                {selected.jokers > 1 ? 's' : ''} · remboursement {selected.pct}% des frais de réservation
              </p>

              {selected.key !== 'Standard' && (
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  Maintien du palier : un minimum de 5 rendez-vous honorés par an est requis. À
                  défaut, déclassement d&apos;un seul palier au 1er janvier suivant, sans perte des
                  Jokers de l&apos;année en cours.
                </p>
              )}

              {selectedAchieved ? (
                <p className="text-[11px] text-slate-500">Vous bénéficiez déjà de ces avantages.</p>
              ) : (
                <>
                  <p className="text-xs text-white leading-snug">
                    Plus que <strong>{selectedRdvToGo} rendez-vous</strong> pour passer au statut{' '}
                    <strong>
                      {TIER_ICON[selected.key]} {selected.key}
                    </strong>
                    {selectedJokersGagnes > 0 && (
                      <>
                        {' '}et gagner{' '}
                        <strong className="text-emerald-400">
                          {selectedJokersGagnes} joker{selectedJokersGagnes > 1 ? 's' : ''} supplémentaire
                          {selectedJokersGagnes > 1 ? 's' : ''}
                        </strong>
                      </>
                    )}{' '}
                    !
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, selectedProgressPct)}%`,
                        background: 'linear-gradient(90deg, #34d399, #6ee7b7)',
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1.5 text-right">
                    {rdv} / {selected.rdv} RDV honorés
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
