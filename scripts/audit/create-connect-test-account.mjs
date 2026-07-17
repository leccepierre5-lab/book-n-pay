// Crée un compte Stripe Connect Express en mode TEST (clé STRIPE_TEST_SECRET_KEY
// uniquement, jamais la route app cassée qui préfère la clé live). Sert à
// débloquer solde-checkout légitimement pour les fixtures d'audit.
//
// Usage : node --env-file=.env.local scripts/audit/create-connect-test-account.mjs <bizId> <bizName>

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const [, , bizId, ...nameParts] = process.argv;
const bizName = nameParts.join(' ');
if (!bizId) { console.error('Usage: node create-connect-test-account.mjs <bizId> <bizName>'); process.exit(1); }

if (!process.env.STRIPE_TEST_SECRET_KEY) {
  console.error('STRIPE_TEST_SECRET_KEY manquant — refus de continuer (ne jamais retomber sur la clé live).');
  process.exit(1);
}
const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY);

const account = await stripe.accounts.create({
  type: 'express',
  country: 'FR',
  metadata: { bizId, bizName: bizName || bizId, fixture: 'audit-multi-metiers' },
});
console.log('Compte Stripe Connect TEST créé:', account.id);

const accountLink = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: 'https://www.book-n-pay.com/pro',
  return_url: 'https://www.book-n-pay.com/pro?stripe_return=1',
  type: 'account_onboarding',
});
console.log('Lien onboarding (test):', accountLink.url);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error } = await supabase
  .from('business_settings')
  .update({ stripe_account_id: account.id })
  .eq('biz_id', bizId);
if (error) { console.error('Erreur MAJ business_settings:', error); process.exit(1); }
console.log('business_settings.stripe_account_id posé (stripe_onboarding_complete reste false tant que le KYC test n\'est pas complété).');
