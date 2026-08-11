'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BNP_PLANS } from '@/lib/plans-config';

function formatEuro(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm text-slate-300">{label}</label>
        <span className="text-sm font-bold text-mint-400">{value}{unit}</span>
      </div>
      <input
        type="range"
        className="slider-mint"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, #34d399 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
        }}
      />
      <div className="flex justify-between mt-1 text-[10px] text-slate-600">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// Toutes les entrées sont saisies par le pro — aucune hypothèse de la
// plateforme (taux de no-show par défaut, facteur d'amélioration, %
// de commission figé) n'est codée en dur. Chaque chiffre affiché en sortie
// est une combinaison directe de ces entrées, jamais une estimation
// contrefactuelle inventée par Book'nPay.
export default function SimulatorPage() {
  const [panierMoyen, setPanierMoyen] = useState(60);
  const [nbReservations, setNbReservations] = useState(80);
  const [noShowsEvites, setNoShowsEvites] = useState(0);
  const [commissionPct, setCommissionPct] = useState(15);
  const [planKey, setPlanKey] = useState<'starter' | 'business' | 'scale'>('starter');

  const plan = BNP_PLANS.find((p) => p.key === planKey)!;

  const {
    coutCommissionClassique,
    economieMensuelle,
    valeurNoShowsEvites,
    totalMensuel,
    totalAnnuel,
  } = useMemo(() => {
    const coutCommissionClassique = nbReservations * panierMoyen * (commissionPct / 100);
    const economieMensuelle = coutCommissionClassique - plan.priceHT;
    const valeurNoShowsEvites = noShowsEvites * panierMoyen;
    const totalMensuel = economieMensuelle + valeurNoShowsEvites;
    const totalAnnuel = totalMensuel * 12;

    return { coutCommissionClassique, economieMensuelle, valeurNoShowsEvites, totalMensuel, totalAnnuel };
  }, [panierMoyen, nbReservations, noShowsEvites, commissionPct, plan]);

  return (
    <div className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/tarifs" className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour aux tarifs
        </Link>

        <header className="mb-10 text-center">
          <p className="text-xs font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-3">SIMULATEUR</p>
          <h1 className="text-3xl font-bold text-white mb-3">Simulez votre cas</h1>
          <p className="text-slate-500 text-sm">Entrez vos propres chiffres — aucune estimation n&apos;est faite à votre place.</p>
        </header>

        {/* Inputs */}
        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6 mb-6 space-y-6">
          <Slider
            label="Panier moyen par prestation"
            value={panierMoyen}
            min={20}
            max={200}
            step={5}
            unit="€"
            onChange={setPanierMoyen}
          />
          <Slider
            label="Nombre de réservations / mois"
            value={nbReservations}
            min={10}
            max={400}
            step={5}
            unit=""
            onChange={setNbReservations}
          />
          <div>
            <Slider
              label="No-shows que vous estimez éviter grâce à Book'nPay / mois"
              value={noShowsEvites}
              min={0}
              max={30}
              step={1}
              unit=""
              onChange={setNoShowsEvites}
            />
            <p className="mt-1.5 text-[11px] text-slate-600">
              Votre propre estimation, d&apos;après votre expérience — Book&apos;nPay n&apos;invente aucun taux à votre place.
            </p>
          </div>
          <div>
            <Slider
              label="Commission d'une plateforme classique, pour comparaison"
              value={commissionPct}
              min={5}
              max={30}
              step={1}
              unit="%"
              onChange={setCommissionPct}
            />
            <p className="mt-1.5 text-[11px] text-slate-600">
              Ajustez selon la plateforme à laquelle vous comparez Book&apos;nPay (les commissions observées vont généralement de 10 à 25 %).
            </p>
          </div>

          <div>
            <label className="text-sm text-slate-300 mb-2 block">Plan Book&apos;nPay</label>
            <div className="grid grid-cols-3 gap-2">
              {BNP_PLANS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPlanKey(p.key)}
                  className={`rounded-xl border px-3 py-2.5 text-center transition-all duration-200 ${
                    planKey === p.key
                      ? 'bg-mint-500 border-mint-500 text-navy-950'
                      : 'bg-navy-800 border-white/[0.08] text-slate-400 hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-bold">{p.label}</p>
                  <p className="text-[11px] opacity-80">{p.priceHT}€/mois</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Résultats */}
        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
            <p className="text-xs text-slate-500 mb-1">Coût mensuel à {commissionPct}% de commission</p>
            <p className="text-2xl font-black text-white">{formatEuro(coutCommissionClassique)}</p>
            <p className="text-[11px] text-slate-600 mt-1">{nbReservations} résa × {panierMoyen}€ × {commissionPct}%</p>
          </div>

          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
            <p className="text-xs text-slate-500 mb-1">Économie sur l&apos;abonnement / mois</p>
            <p className={`text-2xl font-black ${economieMensuelle >= 0 ? 'text-mint-400' : 'text-red-400'}`}>
              {formatEuro(economieMensuelle)}
            </p>
            <p className="text-[11px] text-slate-600 mt-1">{formatEuro(coutCommissionClassique)} − {plan.priceHT}€ (plan {plan.label})</p>
          </div>
        </div>

        {noShowsEvites > 0 && (
          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5 mb-6">
            <p className="text-xs text-slate-500 mb-1">Valeur de vos no-shows évités / mois (votre estimation)</p>
            <p className="text-2xl font-black text-mint-400">{formatEuro(valeurNoShowsEvites)}</p>
            <p className="text-[11px] text-slate-600 mt-1">{noShowsEvites} no-show{noShowsEvites > 1 ? 's' : ''} × {panierMoyen}€</p>
          </div>
        )}

        {/* Le grand chiffre */}
        <div
          className="rounded-2xl border border-mint-500/30 p-8 text-center mb-10"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(52,211,153,0.15) 0%, transparent 70%), #1e293b',
          }}
        >
          <p className="text-xs font-bold tracking-widest text-mint-400/80 uppercase mb-2">Total annuel, d&apos;après vos chiffres</p>
          <p className={`text-5xl font-black mb-1 ${totalAnnuel >= 0 ? 'text-white' : 'text-red-400'}`}>{formatEuro(totalAnnuel)}</p>
          <p className="text-xs text-slate-500">
            économie vs commission classique{noShowsEvites > 0 ? ' + valeur de vos no-shows évités' : ''}
          </p>
        </div>

        <div className="text-center">
          <Link
            href="/devenir-partenaire"
            className="inline-flex items-center gap-2 rounded-2xl py-3.5 px-8 text-sm font-semibold text-navy-950 transition-all hover:scale-[1.01]"
            style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 20px rgba(52,211,153,0.35)' }}
          >
            Devenir partenaire →
          </Link>
        </div>
      </div>
    </div>
  );
}
