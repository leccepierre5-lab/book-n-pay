// src/lib/solde-checkout.ts
// Logique pure derrière /api/bookings/solde-checkout (paiement du solde de
// prestation via Stripe Connect, mode "App" de CaisseEncaissement) : calcul
// du montant, garde-fous d'accès/éligibilité, et décision d'idempotence face
// à une éventuelle session Stripe déjà en cours. Aucun accès réseau ici (pas
// de Supabase, pas de SDK Stripe) — la route se contente d'aller chercher les
// données et d'appliquer ces décisions, ce qui rend ce fichier testable
// unitairement sans mock.
//
// Point de sécurité structurel : aucune fonction ici n'accepte de montant en
// entrée. Le solde ne peut être obtenu qu'en recalculant depuis le prix du
// service + le dépôt réellement enregistré en base — un `amount` fourni par
// le client n'a littéralement nulle part où entrer dans ce calcul.

export function computeSolde(
  servicePrice: number,
  depositPaid: number,
  referralDiscountPct: number
): number {
  const prixTotal = referralDiscountPct > 0
    ? Math.round(servicePrice * (1 - referralDiscountPct / 100) * 100) / 100
    : servicePrice;
  return Math.max(0, Math.round((prixTotal - depositPaid) * 100) / 100);
}

export interface ProProfile {
  role: string | null;
  biz_id: string | null;
}

export function isProAuthorizedForBiz(profile: ProProfile | null, bookingBizId: string): boolean {
  return profile?.role === 'admin' || profile?.biz_id === bookingBizId;
}

export type GuardResult = { ok: true } | { ok: false; error: string; status: number };

export interface MemberEligibility {
  status: string;
  balance_payment_status: string;
}

export function checkMemberEligibleForSoldeCheckout(member: MemberEligibility): GuardResult {
  if (member.status !== 'paid') {
    return { ok: false, error: "Cette prestation n'est pas en attente de clôture", status: 400 };
  }
  if (member.balance_payment_status === 'paid') {
    return { ok: false, error: 'Le solde a déjà été réglé', status: 409 };
  }
  return { ok: true };
}

export function checkSoldeIsPositive(solde: number): GuardResult {
  if (solde <= 0) {
    return { ok: false, error: 'Aucun solde à régler — clôture directement en espèces/TPE', status: 400 };
  }
  return { ok: true };
}

export interface StripeAccountSettings {
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
}

export function isStripeAccountConfigured(settings: StripeAccountSettings | null): boolean {
  return !!settings?.stripe_account_id && !!settings.stripe_onboarding_complete;
}

// Sous-ensemble de Stripe.Checkout.Session utilisé pour la décision — pas
// d'import du SDK Stripe ici, uniquement les champs dont on a besoin.
export interface ExistingStripeSession {
  status: string | null;
  url: string | null;
  id: string;
}

export type SoldeIdempotencyDecision =
  | { action: 'reuse'; url: string; sessionId: string }
  | { action: 'pendingConfirmation' }
  | { action: 'regenerate' };

export function decideSoldeIdempotency(existing: ExistingStripeSession | null): SoldeIdempotencyDecision {
  if (!existing) return { action: 'regenerate' };
  if (existing.status === 'open' && existing.url) {
    return { action: 'reuse', url: existing.url, sessionId: existing.id };
  }
  if (existing.status === 'complete') return { action: 'pendingConfirmation' };
  // 'expired', ou tout autre statut inattendu → on régénère plutôt que de
  // bloquer le pro sur une session morte.
  return { action: 'regenerate' };
}
