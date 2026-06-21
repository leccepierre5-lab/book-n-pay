'use client';
// src/app/(public)/tarifs/page.tsx
// Port de src/pages/Pricing.jsx — page marketing statique, pas de données
// dynamiques. ⚠️ Les forfaits décrits ici (abonnement mensuel SaaS du pro
// à la plateforme : Starter 79€, Business 139€, Scale 299€) sont un AUTRE
// modèle économique que celui implémenté dans le code de paiement actuel
// (frais de réservation + frais de gestion fixe par transaction, payés par
// le CLIENT final). Aucune logique d'abonnement récurrent Stripe pour les
// pros n'existe encore dans ce repo — cette page est purement informative/
// marketing pour l'instant, déconnectée de toute facturation réelle.
import { useState } from 'react';
import Link from 'next/link';

const PLANS = [
  {
    key: 'starter',
    badge: 'Solo & Freelance',
    title: 'Forfait STARTER',
    price: '79€',
    engagement: 'Engagement 3 mois',
    features: [
      "Jusqu'à 80 réservations / mois",
      'Encaissement des frais de réservation en direct',
      'QR code check-in & Trust Score',
      'Apple Pay & Google Pay',
    ],
    borderColor: 'border-blue-500',
    back: {
      title: '📊 Exemple de rentabilité',
      text: "Un professionnel indépendant avec un panier moyen de 35€ qui subit 5 no-shows par mois perd 175€. Avec Book'nPay, ces 5 no-shows sont bloqués par des frais de réservation de 17,50€ — soit 87,50€ encaissés.",
      bilan: "Bilan : l'abonnement de 79€ est entièrement remboursé par la sécurisation de ces 5 personnes seules.",
    },
  },
  {
    key: 'business',
    badge: '⭐ Le plus populaire',
    title: 'Forfait BUSINESS',
    price: '139€',
    engagement: 'Engagement 6 mois',
    features: [
      "Jusqu'à 300 réservations / mois",
      'Mode staff multi-praticiens',
      'Stats CA estimé / réalisé',
      'Programme parrainage intégré',
    ],
    borderColor: 'border-emerald-500',
    highlighted: true,
    back: {
      title: '📊 Exemple de rentabilité',
      text: "Un studio avec 3 salariés, 250 réservations/mois, panier moyen 60€. 10% de no-shows = 25 RDV perdus = 1500€/mois. Les frais de réservation couvrent largement les 139€ de l'abonnement.",
      bilan: 'Bilan : le studio récupère plus de 1300€ de CA autrefois perdu — un ROI proche de 10×.',
    },
  },
  {
    key: 'scale',
    badge: 'Grandes structures',
    title: 'Forfait SCALE',
    price: '299€',
    engagement: 'Engagement 12 mois',
    features: [
      'Réservations illimitées',
      'Multi-personnels & gestion avancée',
      'Frais de réservation dynamiques (clients risqués)',
      'Support client prioritaire',
    ],
    borderColor: 'border-purple-500',
    back: {
      title: '📊 Exemple de rentabilité',
      text: "Une grosse structure réalise +600 réservations/mois, panier moyen 100€. La moindre faille coûte des milliers d'euros par semaine.",
      bilan: "Bilan : pour le prix de 3 prestations dans le mois, le centre s'offre une infrastructure blindée.",
    },
  },
];

export default function TarifsPage() {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const toggleFlip = (key: string) => setFlipped((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-8 inline-block text-white/60 hover:text-white">
          ← Retour
        </Link>

        <header className="mb-12 text-center">
          <h1 className="mb-3 text-3xl font-bold text-white">Plans & Tarifs Book'nPay</h1>
          <p className="text-white/60">Clique sur une carte pour voir l'exemple de rentabilité.</p>
        </header>

        <div className="mb-16 grid gap-6 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <button
              key={plan.key}
              onClick={() => toggleFlip(plan.key)}
              className={`relative h-[420px] rounded-2xl border-2 p-6 text-left transition-all ${
                plan.highlighted ? plan.borderColor : 'border-white/10'
              } bg-navy-900`}
            >
              {!flipped[plan.key] ? (
                <div className="flex h-full flex-col">
                  <span className="mb-4 inline-block self-start rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70">
                    {plan.badge}
                  </span>
                  <h2 className="mb-2 text-xl font-bold text-white">{plan.title}</h2>
                  <p className="text-3xl font-extrabold text-white">
                    {plan.price} <span className="text-sm font-normal text-white/50">/ mois HT</span>
                  </p>
                  <p className="mb-4 text-xs italic text-white/40">{plan.engagement}</p>
                  <ul className="flex-1 space-y-2 text-sm text-white/70">
                    {plan.features.map((f) => (
                      <li key={f}>✅ {f}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs italic text-emerald-400">🔄 Voir la rentabilité</p>
                </div>
              ) : (
                <div className="flex h-full flex-col overflow-y-auto">
                  <h3 className="mb-3 text-base font-bold text-emerald-400">{plan.back.title}</h3>
                  <p className="mb-3 text-sm leading-relaxed text-white/70">{plan.back.text}</p>
                  <div className="rounded-lg border border-emerald-600/30 bg-emerald-950/30 p-3 text-sm text-emerald-400">
                    💡 {plan.back.bilan}
                  </div>
                  <p className="mt-auto text-xs italic text-emerald-400">🔄 Revenir</p>
                </div>
              )}
            </button>
          ))}
        </div>

        <section className="border-t border-white/10 pt-12">
          <h2 className="mb-2 text-center text-xl font-bold text-white">⚙️ Mécanisme de compensation</h2>
          <p className="mb-8 text-center text-sm text-white/50">
            Le modèle tourne en arrière-plan sans risque financier pour toi.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl bg-navy-900 p-6">
              <h3 className="mb-2 font-semibold text-emerald-400">🛡️ La protection Stripe Connect</h3>
              <p className="text-sm leading-relaxed text-white/60">
                Le client paie les frais de réservation + frais techniques. Les frais de réservation
                vont directement sur le compte du professionnel (trésorerie immédiate). Les frais
                techniques arrivent chez Book'nPay et absorbent la commission Stripe.
              </p>
            </div>
            <div className="rounded-xl bg-navy-900 p-6">
              <h3 className="mb-2 font-semibold text-amber-400">📈 La régulation par le hors-forfait</h3>
              <p className="text-sm leading-relaxed text-white/60">
                Un client Starter dépasse ses 80 réservations ? Le système ne bloque rien — chaque
                réservation de dépassement est facturée au pro, incitant naturellement à monter de
                forfait au prochain renouvellement.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
