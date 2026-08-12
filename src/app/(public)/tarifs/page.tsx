'use client';
import Link from 'next/link';
import { calcFraisGestion } from '@/lib/booking-utils';
import { BNP_PLANS, getPraticiensLimit } from '@/lib/plans-config';

const businessPraticiensLimit = getPraticiensLimit('business'); // 3 (2 collaborateurs + le pro)

const FEE_BRACKETS = [
  { label: '≤ 50 €', fee: calcFraisGestion(30) },
  { label: '50,01 € – 80 €', fee: calcFraisGestion(60) },
  { label: '80,01 € – 100 €', fee: calcFraisGestion(90) },
  { label: '> 100 €', fee: calcFraisGestion(150) },
];

const PLANS = [
  {
    key: 'starter',
    badge: 'Pour Démarrer',
    title: 'STARTER',
    promise: 'Pour démarrer ou sécuriser une activité solo.',
    accentColor: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    glowColor: 'rgba(59,130,246,0.12)',
    features: [
      '1 praticien (solo)',
      'Réservations illimitées',
      'Protection anti-no-show & acomptes',
      'Encaissement direct via Stripe Connect',
      'Check-in QR',
      'Apple Pay & Google Pay',
    ],
    cta: 'Démarrer sans engagement →',
  },
  {
    key: 'business',
    badge: 'Le Plus Populaire',
    title: 'BUSINESS',
    promise: 'Pour les cabinets partagés et équipes en croissance.',
    accentColor: 'text-mint-400',
    borderColor: 'border-mint-500/40',
    glowColor: 'rgba(52,211,153,0.12)',
    highlighted: true,
    features: [
      'Tout le plan Starter',
      `Agenda multi-collaborateurs (jusqu'à ${businessPraticiensLimit} praticiens)`,
      'Suivi clair des paiements (en ligne et sur place)',
      'Programme de parrainage entre vos clients',
    ],
    cta: 'Choisir le plan Business →',
  },
  {
    key: 'scale',
    badge: 'Gros Volume',
    title: 'SCALE',
    promise: 'Pour les cabinets pluridisciplinaires et centres de santé.',
    accentColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    glowColor: 'rgba(168,85,247,0.12)',
    features: [
      'Tout le plan Business',
      'Praticiens illimités',
      'Support prioritaire',
    ],
    cta: 'Sélectionner le plan Scale →',
  },
];

const businessEngagement = BNP_PLANS.find((p) => p.key === 'business')!.engagementMonths;
const scaleEngagement = BNP_PLANS.find((p) => p.key === 'scale')!.engagementMonths;

const FAQ_ITEMS = [
  {
    q: 'Qui paie les frais de gestion ?',
    a: "Le client, au moment de la réservation — jamais vous. Ces frais transitent via Stripe Connect et servent de garantie anti no-show.",
  },
  {
    q: "Quel est l'engagement ?",
    a: `Aucun engagement sur le plan Starter. ${businessEngagement} mois pour Business et ${scaleEngagement} mois pour Scale (résiliation possible à l'échéance selon vos conditions contractuelles).`,
  },
  {
    q: "Que se passe-t-il en cas de no-show ?",
    a: "En cas d'absence non annulée dans les délais, la garantie financière (frais de réservation et/ou acompte) est automatiquement conservée et versée sur votre compte Stripe. Aucune relance à effectuer.",
  },
  {
    q: "En quoi est-ce différent des plateformes à commission ?",
    a: "Les plateformes à commission prélèvent un pourcentage sur chaque réservation, à vie. Book'nPay applique un tarif fixe : plus votre volume augmente, plus votre marge reste intacte.",
  },
];

export default function TarifsPage() {
  return (
    <div className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour
        </Link>

        <header className="mb-12 text-center">
          <p className="text-xs font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-3">TARIFICATION</p>
          <h1 className="text-3xl font-bold text-white mb-3">Un abonnement fixe. Zéro commission.</h1>
          <p className="text-slate-500 text-sm">Vous ne payez aucune commission sur vos rendez-vous. Quel que soit votre volume, votre abonnement ne bouge pas.</p>
        </header>

        <div className="mb-16 grid gap-5 sm:grid-cols-3">
          {PLANS.map((plan) => {
          const planConfig = BNP_PLANS.find((p) => p.key === plan.key)!;
          return (
            <div
              key={plan.key}
              className={`relative rounded-2xl border ${plan.borderColor} p-6 text-left overflow-hidden`}
              style={{
                background: `radial-gradient(ellipse at 0% 0%, ${plan.glowColor} 0%, transparent 70%), #1e293b`,
                boxShadow: plan.highlighted ? `0 0 32px ${plan.glowColor}` : undefined,
              }}
            >
              {plan.highlighted && (
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-mint-500/50 to-transparent" />
              )}

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
                  <span className="text-4xl font-black text-white">{planConfig.priceHT}€</span>
                  <span className="text-sm text-slate-500 ml-1">/ mois HT</span>
                </div>
                <p className="text-xs text-slate-600 mb-1 italic">
                  {planConfig.engagementMonths === 0 ? 'Sans engagement' : `Engagement ${planConfig.engagementMonths} mois`}
                </p>
                <p className={`text-xs font-medium mb-5 ${plan.accentColor}`}>{plan.promise}</p>
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
                <Link
                  href="/devenir-partenaire"
                  className={`mt-5 inline-flex items-center justify-center rounded-xl py-2.5 px-4 text-xs font-semibold transition-all hover:scale-[1.01] ${
                    plan.highlighted
                      ? 'text-navy-950'
                      : 'text-white border border-white/15 bg-white/5 hover:bg-white/10'
                  }`}
                  style={plan.highlighted ? { background: 'linear-gradient(135deg, #34d399, #6ee7b7)' } : undefined}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          );
          })}
        </div>

        <section className="border-t border-white/[0.07] pt-12">
          <h2 className="mb-2 text-center text-xl font-bold text-white">Le mécanisme de compensation</h2>
          <p className="mb-8 text-center text-sm text-slate-500">
            Le modèle tourne en arrière-plan sans impacter votre trésorerie.
          </p>
          <div className="max-w-md mx-auto">
            {/* Carte Protection Stripe Connect */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-white text-sm">Protection Stripe Connect</h3>
              <p className="text-xs leading-relaxed text-slate-500 mb-3">
                Le client règle les frais de gestion au moment de réserver. Vous ne payez aucune commission sur vos prestations — les frais de gestion sont réglés par le client, jamais vous.
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
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/simulator"
              className="inline-flex items-center gap-2 rounded-2xl py-3.5 px-6 text-sm font-semibold text-navy-950 transition-all hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 20px rgba(52,211,153,0.35)' }}
            >
              Simuler mon ROI →
            </Link>
            <Link
              href="/etablissement/demo-book-n-pay"
              className="inline-flex items-center gap-2 rounded-2xl py-3.5 px-6 text-sm font-semibold text-white border border-white/15 bg-white/5 transition-all hover:scale-[1.01] hover:bg-white/10"
            >
              Essayer le parcours de réservation →
            </Link>
          </div>
        </section>

        <section className="border-t border-white/[0.07] pt-12 mt-12">
          <h2 className="mb-8 text-center text-xl font-bold text-white">Questions fréquentes</h2>
          <div className="mx-auto max-w-2xl space-y-5">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q} className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
                <h3 className="mb-2 text-sm font-semibold text-white">{item.q}</h3>
                <p className="text-xs leading-relaxed text-slate-500">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
