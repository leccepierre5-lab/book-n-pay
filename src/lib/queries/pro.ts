// src/lib/queries/pro.ts
// Requêtes pour l'espace pro — s'appuient sur RLS (owns_biz) pour la sécurité,
// donc utilisables directement depuis le client une fois authentifié.
import { createClient } from '@/lib/supabase/server';
import { isCreatedOffHours, getParisDateOffsetStr, type BizHoraires } from '@/lib/booking-utils';

export async function getProBookingsForMonth(bizId: string, year: number, month: number) {
  const supabase = await createClient();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_members(*), services(price)')
    .eq('biz_id', bizId)
    .gte('date', from)
    .lte('date', to)
    .neq('status', 'cancelled');

  if (error) {
    console.error('[getProBookingsForMonth]', error.message);
    return [];
  }
  return data || [];
}

export async function getProBookings(bizId: string, opts: { from?: string; to?: string } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from('bookings')
    .select('*, booking_members(*), services(name, price, deposit)')
    .eq('biz_id', bizId)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (opts.from) query = query.gte('date', opts.from);
  if (opts.to) query = query.lte('date', opts.to);

  const { data, error } = await query;
  if (error) {
    console.error('[getProBookings]', error.message);
    return [];
  }
  return data || [];
}

export async function getProProfile() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('*, businesses!fk_app_users_biz(*)')
    .eq('id', authData.user.id)
    .maybeSingle();

  return profile;
}

export async function getBusinessSettings(bizId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('business_settings')
    .select('*')
    .eq('biz_id', bizId)
    .maybeSingle();

  if (error) {
    console.error('[getBusinessSettings]', error.message);
    return null;
  }
  return data;
}

export interface ProStats {
  totalBookings: number;
  // Audit 26/07 : ce chiffre ne comptait QUE les frais de réservation perçus
  // en ligne par Book'nPay (deposit) — jamais le solde de la prestation
  // encaissé sur place par le pro (app/tpe/espèces, cloturer-prestation).
  // Affiché seul sous "CA ce mois", ça sous-évaluait fortement le chiffre
  // d'affaires réel du pro. Séparé en deux chiffres distincts ci-dessous —
  // ne jamais les re-fusionner en un seul total sans le dire explicitement.
  onlineRevenue: number;   // perçu en ligne via Book'nPay (frais de réservation)
  onSiteRevenue: number;   // encaissé sur place par le pro (solde de la prestation)
  noShowRate: number;
  upcomingCount: number;
  // "Ce que Book'nPay vous apporte" (19/07) — volontairement factuels, pas de
  // chiffre spéculatif (ex. "temps gagné" écarté faute de vraie mesure).
  depositSecuredCount: number;   // nb de RDV avec frais de réservation réellement encaissés, CUMUL depuis l'inscription
  depositSecuredAmount: number;  // idem en €. Portée volontairement différente de onlineRevenue (mois
                                  // courant) — un cumul depuis l'inscription, pas le même chiffre sous
                                  // un autre nom (relecture 19/07 : le doublon nuisait à la crédibilité
                                  // du bloc "valeur" au moment où elle compte le plus).
  offHoursBookingsCount: number; // RDV RÉSERVÉS (created_at) hors jour/heure d'ouverture ce mois
  // Frais de gestion refacturés au pro suite à ses propres annulations de RDV
  // (pro_charges, migration 0041 — C15 uniquement, voir pro/cancel-booking).
  // Somme de TOUTES les charges 'pending' (pas de borne de date — la
  // facturation effective, 13/08, ne vide le cumul QUE quand une charge
  // passe réellement 'invoiced', pas sur une base calendaire). Sans ce
  // chiffre, ce serait exactement le frais caché reproché à la
  // concurrence — obligatoire, jamais retirable sans repasser par cette
  // décision.
  // ⚠️ Ce chiffre est un CUMUL, pas un montant mensuel — le composant
  // (ProDashboard.tsx) doit l'afficher sous un libellé "à refacturer", jamais
  // "ce mois" (relecture 11/08 : même classe d'erreur que le bug CA `0655d92`,
  // un libellé "ce mois" sur un cumul devient faux dès le 2e mois).
  proChargesPendingAmount: number;
  // Historique des charges déjà facturées (les 5 plus récentes) — le pro
  // doit voir CE QUI a été facturé et QUAND, pas seulement le cumul en
  // attente ci-dessus (règle posée le 13/08 avec la facturation effective).
  proChargesInvoiced: { amount: number; invoicedAt: string }[];
}

export async function getProStats(bizId: string, biz: BizHoraires): Promise<ProStats> {
  const supabase = await createClient();
  // Ancré sur le mois Paris (pas "local"/runtime) — sur Vercel (UTC), setDate/
  // getMonth/le constructeur Date(y,m,d) opèrent en UTC, décalant les bornes
  // d'un mois entier pendant les ~2h qui suivent minuit Paris le 1er de
  // chaque mois (audit TZ 24/07, même famille que le bug "aujourd'hui").
  const [parisYear, parisMonth] = getParisDateOffsetStr(0).split('-').map(Number);
  const fromDate = `${parisYear}-${String(parisMonth).padStart(2, '0')}-01`;
  // Borne haute ajoutée (audit 19/07) : sans elle, "CA ce mois"/"Réservations"
  // incluaient aussi tout RDV pris à l'avance pour un mois futur — grossit
  // avec le volume ET fausse le libellé "ce mois".
  const lastDayOfMonth = new Date(Date.UTC(parisYear, parisMonth, 0)).getUTCDate();
  const toDate = `${parisYear}-${String(parisMonth).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const { data: bookings } = await supabase
    .from('bookings')
    .select('date, status, created_at, booking_members(status, deposit, payment_mode, referral_discount_pct), services(price)')
    .eq('biz_id', bizId)
    .gte('date', fromDate)
    .lte('date', toDate);

  let onlineRevenue = 0;
  let onSiteRevenue = 0;
  let totalMembers = 0;
  let noShows = 0;
  let offHoursBookingsCount = 0;

  for (const b of bookings || []) {
    if (b.status !== 'cancelled' && isCreatedOffHours(b.created_at, biz)) offHoursBookingsCount++;
    const servicePrice = (b as any).services?.price ?? null;
    for (const m of b.booking_members || []) {
      if (m.status === 'paid' || m.status === 'arrived' || m.status === 'no_show') {
        totalMembers++;
        if (m.deposit) onlineRevenue += m.deposit;
      }
      if (m.status === 'no_show') noShows++;
      // Solde encaissé sur place — seulement quand la clôture a réellement eu
      // lieu (payment_mode posé par cloturer-prestation/route.ts ; un
      // 'arrived' via check-in QR sans clôture n'a pas encore de mode et ne
      // compte donc pas ici, l'argent n'est pas confirmé encaissé). Même
      // calcul que CaisseEncaissement.tsx (prix remisé - dépôt).
      if (m.status === 'arrived' && m.payment_mode && servicePrice != null) {
        const discountPct = m.referral_discount_pct || 0;
        const prixTotal = discountPct > 0
          ? Math.round(servicePrice * (1 - discountPct / 100) * 100) / 100
          : servicePrice;
        onSiteRevenue += Math.max(0, prixTotal - (m.deposit || 0));
      }
    }
  }

  // "À venir" reste volontairement sans borne haute (tout RDV futur compte,
  // peu importe le mois) — requête count-only séparée pour ne pas re-élargir
  // la requête ci-dessus, qui doit rester bornée au mois courant.
  const today = getParisDateOffsetStr(0);
  const { count: upcomingCount } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('biz_id', bizId)
    .gte('date', today)
    .neq('status', 'cancelled');

  const onlineRevenueRounded = Math.round(onlineRevenue * 100) / 100;
  const onSiteRevenueRounded = Math.round(onSiteRevenue * 100) / 100;

  // Cumul depuis l'inscription (pas de borne de date, volontaire) — requête
  // séparée et minimale (une seule colonne) pour ne pas répéter le coût d'un
  // `select('*')` sur tout l'historique. Candidat à une vraie agrégation SQL
  // (vue/RPC SUM) si le volume devient un sujet un jour ; suffisant en l'état.
  const { data: depositRows } = await supabase
    .from('booking_members')
    .select('deposit, bookings!inner(biz_id)')
    .eq('bookings.biz_id', bizId)
    .in('status', ['paid', 'arrived', 'no_show']);

  const depositSecuredCount = depositRows?.length || 0;
  const depositSecuredAmount = Math.round(
    (depositRows || []).reduce((sum, r) => sum + (r.deposit || 0), 0) * 100
  ) / 100;

  // Cumul depuis toujours, pas borné au mois (voir commentaire ProStats) —
  // requête minimale (une seule colonne), même pattern que depositRows.
  const { data: proChargesRows } = await supabase
    .from('pro_charges')
    .select('amount_cents')
    .eq('biz_id', bizId)
    .eq('status', 'pending');

  const proChargesPendingAmount = Math.round(
    (proChargesRows || []).reduce((sum, r) => sum + (r.amount_cents || 0), 0)
  ) / 100;

  // Historique récent des charges déjà facturées — le pro doit voir CE QUI
  // a été facturé et QUAND, pas seulement le cumul en attente (règle posée
  // par Pierre le 13/08, facturation effective des pro_charges). Les 5
  // dernières suffisent pour un dashboard, pas un historique complet.
  const { data: proChargesInvoicedRows } = await supabase
    .from('pro_charges')
    .select('amount_cents, invoiced_at')
    .eq('biz_id', bizId)
    .eq('status', 'invoiced')
    .order('invoiced_at', { ascending: false })
    .limit(5);

  const proChargesInvoiced = (proChargesInvoicedRows || [])
    .filter((r) => r.invoiced_at)
    .map((r) => ({ amount: Math.round(r.amount_cents) / 100, invoicedAt: r.invoiced_at as string }));

  return {
    totalBookings: bookings?.length || 0,
    onlineRevenue: onlineRevenueRounded,
    onSiteRevenue: onSiteRevenueRounded,
    noShowRate: totalMembers > 0 ? Math.round((noShows / totalMembers) * 100) : 0,
    upcomingCount: upcomingCount || 0,
    depositSecuredCount,
    depositSecuredAmount,
    offHoursBookingsCount,
    proChargesPendingAmount,
    proChargesInvoiced,
  };
}
