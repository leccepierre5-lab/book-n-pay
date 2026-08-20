'use client';
import Link from 'next/link';
import { calcFraisGestion, MAX_DEPOSIT_EUROS } from '@/lib/booking-utils';
import { BNP_PLANS, getPraticiensLimit, type PlanKey } from '@/lib/plans-config';

// "Collaborateur", pas "praticien" — vocabulaire aligné le 13/08/2026 :
// "praticien" est connoté bien-être et exclut tatoueurs, photographes,
// toiletteurs, coachs. La fonction source (getPraticiensLimit) garde son
// nom (identifiant interne, pas un texte affiché) — voir plans-config.ts.
// Toujours dérivé de BNP_PLANS.maxStaff, jamais un chiffre en dur : si le
// barème change, ce libellé suit automatiquement.
function teamSizeLabel(planKey: PlanKey): string {
  const limit = getPraticiensLimit(planKey); // total incluant le pro lui-même
  if (limit === null) return 'Collaborateurs illimités';
  // "1 collaborateur" se lisait comme une entitlement ("j'ai le droit d'en
  // ajouter un") alors que Starter est structurellement 0 collaborateur —
  // maxStaff=0, testé et assumé (staff-collaborateur-limit.test.ts) — le
  // pro n'est jamais une ligne `staff`. Trouvé le 14/08 en traçant un piège
  // de réactivation post-downgrade (voir plans-config.ts:getStaffQuotaStatus).
  if (limit === 1) return 'Solo';
  // limit inclut le pro (getPraticiensLimit = maxStaff + 1) : "Jusqu'à 3
  // collaborateurs" promettait un de plus que maxStaff réel (Business:
  // maxStaff=2). "Vous + N" isole le nombre de collaborateurs ajoutables.
  return `Vous + ${limit - 1} collaborateurs`;
}

// Montants dérivés de calcFraisGestion() — source unique du barème réel
// (booking-utils.ts:380, même fonction que stripe/checkout/route.ts), jamais
// réécrits en dur ici. Même principe que BNP_PLANS pour les formules :
// si le barème change, ce tableau suit automatiquement.
const FEE_BRACKETS = [
  { label: 'Jusqu\'à 50 €', fee: calcFraisGestion(30) },
  { label: '50,01 € à 80 €', fee: calcFraisGestion(60) },
  { label: '80,01 € à 100 €', fee: calcFraisGestion(90) },
  { label: 'Plus de 100 €', fee: calcFraisGestion(150) },
];

// Exemple chiffré — dépôt fixé à MAX_DEPOSIT_EUROS (jamais un montant que le
// produit refuserait, voir pro/services/route.ts) et un prix au-delà de
// 100 € pour illustrer le plafond réel des frais de gestion.
const EXAMPLE_PRICE = 800;
const EXAMPLE_DEPOSIT = MAX_DEPOSIT_EUROS;
const EXAMPLE_FEE = calcFraisGestion(EXAMPLE_PRICE);
const EXAMPLE_REMAINING = EXAMPLE_PRICE - EXAMPLE_DEPOSIT;

// Même produit partout — seule la taille d'équipe change de plan à plan
// (vérifié en code le 13/08/2026 : aucune fonctionnalité réelle n'est
// gardée derrière Business/Scale en dehors du nombre de collaborateurs et
// du support — recherche exhaustive de plan_key/planKey dans tout src/,
// 9 occurrences, aucune autre que staff/billing/admin/marketing). Le
// programme de parrainage n'apparaît nulle part ici : c'est une
// fonctionnalité CLIENT (referral_events n'a pas de biz_id, un filleul
// peut réserver chez n'importe quel pro), pas un avantage du pro — le
// lister comme argument de vente pro serait faux, pas seulement mal placé.
// Liste complète répétée sur chaque carte (14/08) — auparavant Business/Scale
// disaient juste "Tout le plan Starter"/"Tout le plan Business", ce qui
// laissait un grand vide visuel avec seulement 2 items listés. Les trois
// formules ont exactement les mêmes fonctionnalités (voir commentaire
// au-dessus de PLANS) : les répéter en toutes lettres comble le vide sans
// rien inventer.
const STARTER_FEATURES = [
  'Réservations illimitées',
  'Protection anti-no-show & frais de réservation',
  'Encaissement direct via Stripe Connect',
  'Check-in QR',
  'Apple Pay & Google Pay',
  'Suivi des paiements',
];

const PLANS = [
  {
    key: 'starter' as const,
    badge: 'Pour Démarrer',
    title: 'STARTER',
    promise: 'Votre agenda en ligne, et plus jamais de créneau perdu.',
    featuresIntro: 'Toutes les fonctionnalités incluses',
    accentColor: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    glowColor: 'rgba(59,130,246,0.12)',
    features: STARTER_FEATURES,
    cta: 'Démarrer sans engagement →',
  },
  {
    key: 'business' as const,
    badge: 'Le Plus Populaire',
    title: 'BUSINESS',
    promise: 'Votre équipe sur un seul agenda, vos paiements au clair.',
    featuresIntro: 'Toutes les fonctionnalités incluses',
    accentColor: 'text-mint-400',
    borderColor: 'border-mint-500/40',
    glowColor: 'rgba(52,211,153,0.12)',
    highlighted: true,
    features: [...STARTER_FEATURES, 'Agenda multi-collaborateurs'],
    cta: 'Choisir le plan Business →',
  },
  {
    key: 'scale' as const,
    badge: 'Grande Équipe',
    title: 'SCALE',
    promise: 'Toute votre structure, sans limite de collaborateurs.',
    featuresIntro: 'Toutes les fonctionnalités incluses',
    accentColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    glowColor: 'rgba(168,85,247,0.12)',
    features: [...STARTER_FEATURES, 'Agenda multi-collaborateurs', 'Support prioritaire'],
    cta: 'Choisir le plan Scale →',
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
    a: "En cas d'absence non annulée dans les délais, les frais de réservation sont automatiquement conservés et versés sur votre compte Stripe. Aucune relance à effectuer.",
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

        <div className="mb-4 grid gap-5 sm:grid-cols-3">
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
                  {' · '}
                  {teamSizeLabel(plan.key)}
                </p>
                <p className={`text-xs font-medium mb-5 ${plan.accentColor}`}>{plan.promise}</p>
                {plan.featuresIntro && (
                  <p className="mb-2 text-xs font-semibold text-white">{plan.featuresIntro}</p>
                )}
                {/* Listes désormais quasi équilibrées entre cartes (14/08 :
                    Business/Scale listent la totalité des fonctionnalités,
                    pas juste "Tout le plan Starter") — justify-center gardé
                    en filet, répartit un éventuel écart résiduel avant ET
                    après la liste plutôt qu'un seul gros vide en bas. */}
                <ul className="flex-1 flex flex-col justify-center space-y-2.5">
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
                  href={`/devenir-partenaire?plan=${plan.key}`}
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

        <p className="mb-16 text-center text-sm font-medium text-slate-300">
          Le prix dépend uniquement du nombre de collaborateurs. Toutes les fonctionnalités sont incluses dans les trois formules.
        </p>

        <section className="border-t border-white/[0.07] pt-12">
          <h2 className="mb-2 text-center text-xl font-bold text-white">
            Des frais de gestion simples, plafonnés à {calcFraisGestion(150).toFixed(2).replace('.', ',')} €
          </h2>
          <p className="mb-8 text-center text-sm text-slate-500">
            Le client règle les frais de gestion au moment de la réservation. Vous ne payez aucune commission sur vos prestations.
          </p>
          <div className="max-w-md mx-auto space-y-5">
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
                </svg>
              </div>
              <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">Montant de la prestation</th>
                      <th className="px-3 py-2 text-right text-slate-500 font-medium whitespace-nowrap">Frais de gestion TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FEE_BRACKETS.map((b, i) => (
                      <tr key={i} className={i < FEE_BRACKETS.length - 1 ? 'border-b border-white/[0.05]' : ''}>
                        <td className="px-3 py-2 text-slate-400">{b.label}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-400 whitespace-nowrap">
                          {b.fee.toFixed(2).replace('.', ',')} €{i === FEE_BRACKETS.length - 1 ? ' max.' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Exemple chiffré — montants dérivés (EXAMPLE_*), jamais écrits
                en dur : si calcFraisGestion ou MAX_DEPOSIT_EUROS changent,
                cet exemple reste exact. */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-6">
              <p className="mb-3 text-xs font-semibold text-white">Exemple</p>
              <dl className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Prestation</dt>
                  <dd className="text-slate-300">{EXAMPLE_PRICE} €</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Frais de réservation, versés au professionnel et déduits du prix</dt>
                  <dd className="text-slate-300 shrink-0 ml-3">{EXAMPLE_DEPOSIT} €</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Frais de gestion, payés par le client</dt>
                  <dd className="text-emerald-400 font-semibold shrink-0 ml-3">
                    {EXAMPLE_FEE.toFixed(2).replace('.', ',')} €
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-white/[0.07] pt-2 mt-2">
                  <dt className="text-slate-400 font-medium">Reste à régler sur place</dt>
                  <dd className="text-white font-semibold">{EXAMPLE_REMAINING} €</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 font-medium">Vous</dt>
                  <dd className="text-emerald-400 font-semibold">Aucune commission sur les {EXAMPLE_PRICE} €</dd>
                </div>
              </dl>
            </div>

            <p className="text-center text-xs text-slate-500 leading-relaxed">
              Quel que soit le montant de votre prestation, votre client ne paie jamais plus de{' '}
              {calcFraisGestion(150).toFixed(2).replace('.', ',')} € de frais de gestion, et vous ne payez aucune commission.
            </p>
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
