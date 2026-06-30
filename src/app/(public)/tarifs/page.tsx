'use client';
import { useState } from 'react';
import Link from 'next/link';
import { calcFraisGestion } from '@/lib/booking-utils';
import { BNP_PLANS, OVERAGE_GRACE, OVERAGE_FEE_HT } from '@/lib/plans-config';

const FEE_BRACKETS = [
  { label: '≤ 50 €', fee: calcFraisGestion(30) },
  { label: '50,01 € – 80 €', fee: calcFraisGestion(60) },
  { label: '80,01 € – 100 €', fee: calcFraisGestion(90) },
  { label: '> 100 €', fee: calcFraisGestion(150) },
];

const PLANS = [
  {
    key: 'starter',
    badge: 'Solo & Freelance',
    title: 'STARTER',
    price: '79',
    engagement: '3 mois',
    accentColor: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    glowColor: 'rgba(59,130,246,0.12)',
    features: [
      "Jusqu'à 80 réservations / mois",
      'Encaissement direct des frais',
      'QR code check-in & Trust Score',
      'Apple Pay & Google Pay',
    ],
    back: {
      title: 'Exemple de rentabilité',
      para1: "Un indépendant avec un panier moyen de 35 €. 5 lapins/mois = 175 € perdus.",
      para2: "Avec Book'nPay, ces 5 lapins sont bloqués par des frais de 17,50 €. Non-présence = 5 × 17,50 € = 87,50 € encaissés.",
      bilan: "L'abonnement à 79 € est entièrement remboursé. Net cost = 0 €.",
    },
  },
  {
    key: 'business',
    badge: 'Le Plus Populaire',
    title: 'BUSINESS',
    price: '139',
    engagement: '6 mois',
    accentColor: 'text-mint-400',
    borderColor: 'border-mint-500/40',
    glowColor: 'rgba(52,211,153,0.12)',
    highlighted: true,
    features: [
      "Jusqu'à 300 réservations / mois",
      'Mode staff multi-praticiens',
      'Stats CA estimé / réalisé',
      'Programme parrainage intégré',
    ],
    back: {
      title: 'Exemple de rentabilité',
      para1: 'Studio de bien-être, 3 salariés, 250 RDV/mois, panier 60 €. 10 % no-shows = 1 500 €/mois perdus.',
      para2: "Business à 139 € sécurise ces créneaux. 5 oublis couvrent largement l'abonnement.",
      bilan: "+1 300 € de CA récupéré. ROI de 10× le prix de l'abonnement.",
    },
  },
  {
    key: 'scale',
    badge: 'Grandes Structures',
    title: 'SCALE',
    price: '299',
    engagement: '12 mois',
    accentColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    glowColor: 'rgba(168,85,247,0.12)',
    features: [
      'Réservations ILLIMITÉES',
      'Multi-personnels avancé',
      'Frais dynamiques clients risqués',
      'Support client prioritaire',
    ],
    back: {
      title: 'Exemple de rentabilité',
      para1: "+600 réservations/mois, panier 100 €. Chaque faille coûte des milliers d'euros par semaine.",
      para2: "299 € offre la tranquillité absolue : automatisation complète, zéro faille dans l'agenda.",
      bilan: "Pour 3 prestations/mois, une infrastructure blindée. Zéro créneaux perdus.",
    },
  },
];

export default function TarifsPage() {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const toggleFlip = (key: string) => setFlipped((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour
        </Link>

        <header className="mb-12 text-center">
          <p className="text-xs font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-3">TARIFICATION</p>
          <h1 className="text-3xl font-bold text-white mb-3">Plans & Tarifs</h1>
          <p className="text-slate-500 text-sm">Cliquez sur une carte pour voir l'exemple de rentabilité.</p>
        </header>

        <div className="mb-16 grid gap-5 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <button
              key={plan.key}
              onClick={() => toggleFlip(plan.key)}
              className={`relative rounded-2xl border ${plan.borderColor} p-6 text-left transition-all duration-300 overflow-hidden group hover:scale-[1.01]`}
              style={{
                background: `radial-gradient(ellipse at 0% 0%, ${plan.glowColor} 0%, transparent 70%), #1e293b`,
                boxShadow: plan.highlighted ? `0 0 32px ${plan.glowColor}` : undefined,
              }}
            >
              {plan.highlighted && (
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-mint-500/50 to-transparent" />
              )}

              {!flipped[plan.key] ? (
                <div className="flex h-full flex-col min-h-[380px]">
                  <span className={`mb-4 inline-flex items-center self-start rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    plan.highlighted
                      ? 'bg-mint-500/15 text-mint-400 border border-mint-500/25'
                      : 'bg-white/8 text-slate-400 border border-white/10'
                  }`}>
                    {plan.badge}
                  </span>
                  <h2 className={`text-xl font-black mb-1 ${plan.accentColor}`}>{plan.title}</h2>
                  <div className="mb-1">
                    <span className="text-4xl font-black text-white">{plan.price}€</span>
                    <span className="text-sm text-slate-500 ml-1">/ mois HT</span>
                  </div>
                  <p className="text-xs text-slate-600 mb-5 italic">Engagement {plan.engagement}</p>
                  <ul className="flex-1 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                        <svg className={`w-4 h-4 shrink-0 mt-0.5 ${plan.accentColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-4 text-xs ${plan.accentColor} opacity-60`}>
                    Voir la rentabilité →
                  </p>
                </div>
              ) : (
                <div className="flex h-full flex-col min-h-[380px]">
                  <div className={`w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-4`}>
                    <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                    </svg>
                  </div>
                  <h3 className="text-sm font-bold text-emerald-400 mb-3">{plan.back.title}</h3>
                  <p className="text-xs leading-relaxed text-slate-400 mb-3">{plan.back.para1}</p>
                  <p className="text-xs leading-relaxed text-slate-400 mb-4">{plan.back.para2}</p>
                  <div className="rounded-xl border border-emerald-600/25 bg-emerald-950/30 p-3 flex-1">
                    <p className="text-xs text-emerald-400 leading-relaxed">
                      <span className="font-bold">Bilan :</span> {plan.back.bilan}
                    </p>
                  </div>
                  <p className="mt-4 text-xs text-slate-600">← Retour</p>
                </div>
              )}
            </button>
          ))}
        </div>

        <section className="border-t border-white/[0.07] pt-12">
          <h2 className="mb-2 text-center text-xl font-bold text-white">Le mécanisme de compensation</h2>
          <p className="mb-8 text-center text-sm text-slate-500">
            Le modèle tourne en arrière-plan sans vous mettre en danger.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Carte Protection Stripe Connect */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-white text-sm">Protection Stripe Connect</h3>
              <p className="text-xs leading-relaxed text-slate-500 mb-3">
                Le client paie les frais de gestion + le prix de la prestation. Le montant des frais varie selon le prix de la prestation réservée.
              </p>
              <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">Prix prestation</th>
                      <th className="px-3 py-2 text-right text-slate-500 font-medium">Frais TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FEE_BRACKETS.map((b, i) => (
                      <tr key={i} className={i < FEE_BRACKETS.length - 1 ? 'border-b border-white/[0.05]' : ''}>
                        <td className="px-3 py-2 text-slate-400">{b.label}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">
                          {b.fee.toFixed(2).replace('.', ',')} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Carte Hors-Forfait */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/12 border border-amber-500/20 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-white text-sm">Régulation par le Hors-Forfait</h3>
              <p className="text-xs leading-relaxed text-slate-500 mb-3">
                Chaque plan inclut un quota mensuel de réservations. Au-delà, un droit à l'erreur s'applique avant tout surcoût.
              </p>
              <div className="space-y-2 mb-3">
                {BNP_PLANS.filter((p) => p.quota !== null).map((p) => (
                  <div key={p.key} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 capitalize">{p.label}</span>
                    <span className="text-slate-400">{p.quota} réservations incluses</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Scale</span>
                  <span className="text-emerald-400 font-medium">Illimité</span>
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-3 space-y-1.5 text-xs text-slate-400">
                <p>
                  <span className="text-white font-medium">Droit à l'erreur :</span>{' '}
                  les {OVERAGE_GRACE} réservations au-delà du quota sont gratuites.
                </p>
                <p>
                  <span className="text-white font-medium">Au-delà :</span>{' '}
                  {OVERAGE_FEE_HT.toFixed(2).replace('.', ',')} € HT / réservation supplémentaire, prélevés immédiatement + proposition de montée de plan.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/simulator"
              className="inline-flex items-center gap-2 rounded-2xl py-3.5 px-6 text-sm font-semibold text-navy-950 transition-all hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 20px rgba(52,211,153,0.35)' }}
            >
              Simuler mon ROI →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
