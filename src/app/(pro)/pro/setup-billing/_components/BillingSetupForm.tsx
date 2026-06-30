'use client';
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  IbanElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import type { PlanConfig } from '@/lib/plans-config';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const ELEMENT_STYLE = {
  base: {
    color: '#f1f5f9',
    fontFamily: 'inherit',
    fontSize: '14px',
    '::placeholder': { color: '#475569' },
  },
  invalid: { color: '#f87171' },
};

function SetupForm({
  clientSecret,
  planConfig,
  proName,
  proEmail,
}: {
  clientSecret: string;
  planConfig: PlanConfig;
  proName: string;
  proEmail: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [tab, setTab] = useState<'card' | 'sepa_debit'>('card');
  const [name, setName] = useState(proName);
  const [email, setEmail] = useState(proEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    try {
      let result;

      if (tab === 'card') {
        const card = elements.getElement(CardElement);
        if (!card) return;
        result = await stripe.confirmCardSetup(clientSecret, {
          payment_method: {
            card,
            billing_details: { name, email },
          },
        });
      } else {
        const iban = elements.getElement(IbanElement);
        if (!iban) return;
        result = await stripe.confirmSepaDebitSetup(clientSecret, {
          payment_method: {
            sepa_debit: iban,
            billing_details: { name, email },
          },
        });
      }

      if (result.error) {
        setError(result.error.message ?? 'Erreur Stripe');
        return;
      }

      const paymentMethodId = result.setupIntent?.payment_method as string;

      const res = await fetch('/api/pro/setup-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethodId, paymentMethodType: tab }),
      });

      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Erreur serveur');
        return;
      }

      window.location.href = '/pro/onboarding';
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Résumé du plan */}
      <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Votre plan</p>
            <p className="text-lg font-black text-white mt-0.5">{planConfig.label.toUpperCase()}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-white">{planConfig.priceHT} €</p>
            <p className="text-xs text-slate-500">/ mois HT · engagement {planConfig.engagementMonths} mois</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Premier prélèvement le 1er du mois prochain (prorata calculé par Stripe). Reconduction automatique.
        </p>
      </div>

      {/* Sélecteur CB / SEPA */}
      <div className="flex gap-2">
        {(['card', 'sepa_debit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
              tab === t
                ? 'bg-mint-500 text-navy-950'
                : 'bg-white/[0.06] text-slate-400 hover:bg-white/10'
            }`}
          >
            {t === 'card' ? '💳 Carte bancaire' : '🏦 Prélèvement SEPA'}
          </button>
        ))}
      </div>

      {/* Champs communs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nom complet</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
          />
        </div>
        {tab === 'sepa_debit' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">Email (pour le mandat)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
            />
          </div>
        )}
      </div>

      {/* Stripe Element */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
        {tab === 'card' ? (
          <CardElement options={{ style: ELEMENT_STYLE }} />
        ) : (
          <IbanElement
            options={{
              supportedCountries: ['SEPA'],
              style: ELEMENT_STYLE,
              placeholderCountry: 'FR',
            }}
          />
        )}
      </div>

      {/* Texte mandat SEPA (obligatoire réglementairement) */}
      {tab === 'sepa_debit' && (
        <p className="text-[11px] text-slate-600 leading-relaxed">
          En fournissant votre IBAN et en confirmant, vous autorisez Book&apos;nPay et Stripe à
          envoyer des instructions à votre banque pour débiter votre compte, conformément aux
          modalités convenues. Vous bénéficiez du droit à un remboursement dans les conditions
          prévues par votre accord bancaire. Un remboursement doit être demandé dans un délai de
          8 semaines à compter de la date de débit.
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full rounded-xl bg-mint-500 py-3 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Traitement en cours...' : 'Activer mon abonnement →'}
      </button>
    </form>
  );
}

export default function BillingSetupForm({
  planConfig,
  proName,
  proEmail,
}: {
  planConfig: PlanConfig;
  proName: string;
  proEmail: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    fetch('/api/pro/setup-billing/intent')
      .then((r) => r.json())
      .then((d) => {
        if (d.clientSecret) setClientSecret(d.clientSecret);
        else setFetchError(d.error ?? 'Erreur initialisation');
      })
      .catch(() => setFetchError('Erreur réseau'));
  }, []);

  if (fetchError) return <p className="text-xs text-red-400">{fetchError}</p>;
  if (!clientSecret) {
    return <p className="text-sm text-slate-500 text-center py-8">Initialisation...</p>;
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, locale: 'fr' }}>
      <SetupForm
        clientSecret={clientSecret}
        planConfig={planConfig}
        proName={proName}
        proEmail={proEmail}
      />
    </Elements>
  );
}
