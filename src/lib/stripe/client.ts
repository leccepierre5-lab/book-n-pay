// src/lib/stripe/client.ts
// Source UNIQUE de sélection de la clé Stripe test/live (app_config.
// mode_test_paiement). Centralisé le 20/07 (audit architecture) : cette
// logique était copiée-collée indépendamment dans 11 fichiers, et 3 routes
// avaient chacune leur propre variante buggée qui l'ignorait purement et
// simplement (pay-for-member, cancel, use-joker, transactions) — la
// duplication route par route était la cause racine commune. Toute route
// qui a besoin d'un client Stripe doit passer par ici, plus jamais lire
// process.env.STRIPE_SECRET_KEY/STRIPE_TEST_SECRET_KEY directement.
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

async function resolveTestMode(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'mode_test_paiement')
    .maybeSingle();
  return data?.value === 'true';
}

// Cas majoritaire : la route n'a besoin que du client Stripe.
export async function getStripeClient(supabase: SupabaseClient): Promise<Stripe> {
  const { stripe } = await getStripeClientWithMode(supabase);
  return stripe;
}

// Cas minoritaire (checkout, pay-for-member) : la route a aussi besoin de
// savoir si on est en mode test pour une décision annexe (ex. garde-fou
// Connect obligatoire hors mode test) — évite de refaire une 2e requête
// app_config ou de dupliquer le ternaire de sélection de clé.
export async function getStripeClientWithMode(
  supabase: SupabaseClient
): Promise<{ stripe: Stripe; isTestMode: boolean }> {
  const isTestMode = await resolveTestMode(supabase);
  const stripe = new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);
  return { stripe, isTestMode };
}
