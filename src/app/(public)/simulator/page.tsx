'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BNP_PLANS } from '@/lib/plans-config';

function formatEuro(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

function formatNombre(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function formatEuroPrecis(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
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

type OutilKey = 'agenda' | 'fixe' | 'commission' | 'autre';

// Présélections indicatives, jamais figées — le pro garde la main sur les
// deux champs après sélection. Pour "Plateforme à commission", seul
// l'abonnement est préempli (0€, ces plateformes n'en facturent pas) ; la
// commission n'a volontairement aucune valeur par défaut inventée, le pro
// la règle lui-même selon son propre outil.
const OUTILS_ACTUELS: { key: OutilKey; label: string; hint?: string; abonnement?: number; commission?: number }[] = [
  { key: 'agenda', label: 'Agenda papier / téléphone / SMS', abonnement: 0, commission: 0 },
  { key: 'fixe', label: 'Logiciel à abonnement fixe', hint: 'ex. Resalib, Perfactive', abonnement: 39.99, commission: 0 },
  { key: 'commission', label: 'Plateforme à commission', hint: 'ex. Planity, Treatwell', abonnement: 0 },
  { key: 'autre', label: 'Autre / je saisis mes chiffres' },
];

// Toutes les entrées sont saisies par le pro — aucune hypothèse de la
// plateforme n'est codée en dur. Le taux de no-show et la commission sont
// des pourcentages (pas des valeurs absolues) pour que le nombre d'absences
// se recalcule correctement quand le volume de réservations change.
//
// Défaut : agenda papier/téléphone (0€ abonnement, 0% commission) — le cas
// le plus fréquent sur la cible. Le sélecteur "votre solution actuelle"
// pré-remplit abonnement + commission à titre indicatif seulement.
//
// Aucun taux d'évitement de no-show n'est demandé ni affiché : la sortie
// montre la perte ACTUELLE du pro, jamais un gain hypothétique attribué à
// Book'nPay. Aucune synthèse prédictive ("vous gagnerez X") — le praticien
// déduit lui-même en comparant les deux blocs de sortie, qui restent
// séparés (jamais fusionnés en un "bilan net").
export default function SimulatorPage() {
  const [panierMoyen, setPanierMoyen] = useState(60);
  const [nbReservations, setNbReservations] = useState(80);
  const [noShowRatePct, setNoShowRatePct] = useState(0);
  const [outilKey, setOutilKey] = useState<OutilKey>('agenda');
  const [abonnementActuel, setAbonnementActuel] = useState(0);
  const [commissionPct, setCommissionPct] = useState(0);
  const [planKey, setPlanKey] = useState<'starter' | 'business' | 'scale'>('starter');

  const plan = BNP_PLANS.find((p) => p.key === planKey)!;

  const selectOutil = (key: OutilKey) => {
    const outil = OUTILS_ACTUELS.find((o) => o.key === key)!;
    setOutilKey(key);
    if (outil.abonnement !== undefined) setAbonnementActuel(outil.abonnement);
    if (outil.commission !== undefined) setCommissionPct(outil.commission);
  };

  const { absencesParMois, perteParMois, coutCommissionActuelle, coutOutilActuel, ecartMensuel } = useMemo(() => {
    const absencesParMois = nbReservations * (noShowRatePct / 100);
    const perteParMois = absencesParMois * panierMoyen;
    const coutCommissionActuelle = nbReservations * panierMoyen * (commissionPct / 100);
    const coutOutilActuel = abonnementActuel + coutCommissionActuelle;
    const ecartMensuel = coutOutilActuel - plan.priceHT;

    return { absencesParMois, perteParMois, coutCommissionActuelle, coutOutilActuel, ecartMensuel };
  }, [panierMoyen, nbReservations, noShowRatePct, abonnementActuel, commissionPct, plan]);

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
              label="Taux de no-show actuel"
              value={noShowRatePct}
              min={0}
              max={30}
              step={1}
              unit="%"
              onChange={setNoShowRatePct}
            />
            <p className="mt-1.5 text-[11px] text-slate-600">
              La part de vos réservations qui se soldent aujourd&apos;hui par une absence non prévenue.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-300 mb-2 block">Votre solution actuelle</label>
            <div className="grid grid-cols-2 gap-2">
              {OUTILS_ACTUELS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => selectOutil(o.key)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                    outilKey === o.key
                      ? 'bg-mint-500 border-mint-500 text-navy-950'
                      : 'bg-navy-800 border-white/[0.08] text-slate-400 hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-bold">{o.label}</p>
                  {o.hint && <p className="text-[11px] opacity-80">{o.hint}</p>}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600">
              Pré-remplit l&apos;abonnement et la commission ci-dessous, à titre indicatif — les deux restent modifiables.
            </p>
            {outilKey === 'commission' && (
              <p className="mt-1 text-[11px] text-mint-400/80">
                Indiquez le taux prélevé par votre plateforme dans le curseur commission ci-dessous.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-slate-300">Abonnement de votre outil actuel</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={0.01}
                  value={abonnementActuel}
                  onChange={(e) => setAbonnementActuel(Math.max(0, Number(e.target.value)))}
                  className="w-20 rounded-lg bg-navy-800 border border-white/10 px-2 py-1 text-sm font-bold text-mint-400 text-right focus:outline-none focus:border-mint-500/50"
                />
                <span className="text-sm font-bold text-mint-400">€/mois</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-600">
              0 € si vous n&apos;avez pas d&apos;abonnement logiciel aujourd&apos;hui.
            </p>
          </div>

          <div>
            <Slider
              label="Commission de l'outil actuel"
              value={commissionPct}
              min={0}
              max={30}
              step={1}
              unit="%"
              onChange={setCommissionPct}
            />
            <p className="mt-1.5 text-[11px] text-slate-600">
              0 % si votre outil actuel ne prend pas de commission par réservation.
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

        {/* Résultats — données brutes, aucune synthèse prédictive */}
        <div className="grid gap-4 mb-10">
          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
            <p className="text-xs text-slate-500 mb-1">Manque à gagner actuel (no-shows)</p>
            <p className="text-2xl font-black text-white">{formatEuro(perteParMois)} / mois</p>
            <p className="text-[11px] text-slate-600 mt-1">
              {noShowRatePct}% × {nbReservations} résa = {formatNombre(absencesParMois)} absence{absencesParMois > 1 ? 's' : ''}/mois × {panierMoyen}€ perdus
            </p>
          </div>

          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
            <p className="text-xs text-slate-500 mb-1">Comparatif de coût mensuel</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl font-black text-white">{formatEuro(coutOutilActuel)}</span>
              <span className="text-xs text-slate-500">
                outil actuel ({formatEuroPrecis(abonnementActuel)} abonnement + {commissionPct}% × {nbReservations} résa × {panierMoyen}€ = {formatEuro(coutCommissionActuelle)} commission)
              </span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap mt-2">
              <span className="text-2xl font-black text-mint-400">{formatEuro(plan.priceHT)}</span>
              <span className="text-xs text-slate-500">Book&apos;nPay, plan {plan.label}, abonnement fixe</span>
            </div>
            <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-baseline gap-2">
              <span className={`text-lg font-black ${ecartMensuel >= 0 ? 'text-mint-400' : 'text-red-400'}`}>
                {ecartMensuel >= 0 ? '' : '-'}{formatEuro(Math.abs(ecartMensuel))}
              </span>
              <span className="text-xs text-slate-500">
                {ecartMensuel >= 0 ? "d'écart par mois" : "d'écart par mois (Book'nPay plus cher sur ce plan)"}
              </span>
            </div>
            {/* Affiché seulement pour les 3 solutions dont on connaît le périmètre réel —
                pour "Autre", on ignore ce que fait déjà l'outil du pro, donc on ne peut pas
                honnêtement dire ce que Book'nPay "ajoute". Aucun montant sur les fonctionnalités
                elles-mêmes, seul l'écart déjà calculé est chiffré. */}
            {outilKey !== 'autre' && (
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                {ecartMensuel < 0 ? (
                  <>Pour {formatEuro(-ecartMensuel)} de plus par mois, vous ajoutez : </>
                ) : (
                  <>Vous ajoutez : </>
                )}
                prépaiement du créneau, indemnisation automatique en cas d&apos;absence, check-in QR.
              </p>
            )}
          </div>
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
