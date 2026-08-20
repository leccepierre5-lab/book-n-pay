// scripts/audit/prepare-demo-visite.mjs
//
// Prépare (ou remet à zéro) les deux comptes de démonstration commerciale
// permanents — demo-pro@book-n-pay.invalid et demo-client@book-n-pay.invalid
// — utilisés en visite chez un professionnel (toilettage canin, tatouage) et
// jamais prêtés : Pierre garde l'appareil en main pendant la démo (décision
// du 20/08/2026, voir mémoire projet). Rejouable sans effet de bord : chaque
// exécution retrouve les DEUX comptes par email/slug fixes, met à jour
// l'établissement selon --metier, PURGE puis RECRÉE la semaine de
// réservations — c'est la commande de remise à zéro entre deux visites.
//
// ⚠️ RACCOURCIS ASSUMÉS (script, pas les vraies routes) — un futur lecteur
// doit savoir qu'aucune de ces réservations n'a jamais vu Stripe ni les
// vrais chemins de changement de statut :
//   1. PAIEMENT — booking_members.status posé directement à 'paid'/'arrived'/
//      'no_show'. Un script ne peut pas jouer un vrai paiement carte Stripe
//      sans navigateur ; checkout.session.completed n'est jamais appelé,
//      donc aucun email de confirmation ne part (voir lib/email/send.ts,
//      jamais importé ici).
//   2. ARRIVÉE / NO-SHOW — normalement posés par checkin-by-qr,
//      cloturer-prestation, ou le cron check-no-shows (qui envoie un email
//      réel). Posés ici directement en base pour la même raison qu'au point 1,
//      ET pour éviter que le vrai cron check-no-shows (qui tourne chaque jour
//      en prod sur tout booking encore 'paid' 15+ min après son horaire)
//      vienne rattraper une réservation de démo de façon non déterministe et
//      envoie un email (même inoffensif sur une adresse .invalid, pas
//      maîtrisé). Un booking encore 'paid' ne peut donc jamais être créé ici
//      avec une date+heure déjà passée.
//   3. FIDÉLITÉ — app_users.rdv_honores/statut/jokers_* du client démo
//      principal posés directement à un palier Bronze (18-20 RDV). Le vrai
//      chemin (loyalty/update-status, +1 par appel) demanderait de simuler
//      18-20 RDV honorés réels — hors de portée d'un script de préparation
//      de démo. Une seule vraie réservation 'arrived' est quand même créée
//      pour ce client chez l'établissement démo, pour que
//      get_client_loyalty_for_pro (migration 0062, via check_booking_access
//      → owns_biz) trouve un lien réel et accepte de répondre.
//
// Tout le reste (création de l'établissement, des prestations, des
// réservations elles-mêmes) passe par les vraies routes/fonctions du code :
// RPC create_solo_booking_with_overlap_check (même fonction que
// src/app/api/bookings/create/route.ts pour un service individuel sans
// staff), calcFraisGestion recopié à l'identique de booking-utils.ts:380
// pour que les montants affichés soient ceux que Stripe aurait vraiment
// calculés (dépôt + frais de gestion selon le barème réel).
//
// Les 1000 fiches génériques (supabase/seed/demo_businesses.sql) ne sont
// JAMAIS touchées par ce script — ni ici ni dans cleanup-demo-visite.mjs.
//
// Usage :
//   node --env-file=.env.local scripts/audit/prepare-demo-visite.mjs --metier=animaux
//   node --env-file=.env.local scripts/audit/prepare-demo-visite.mjs --metier=tatouage-piercing
//
// Connexion sans mot de passe (voir CLAUDE.md, section "Tester un parcours
// connecté sans mot de passe") :
//   node scripts/audit/passwordless-login-link.mjs demo-pro@book-n-pay.invalid
//   node scripts/audit/passwordless-login-link.mjs demo-client@book-n-pay.invalid

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// ── Recopié depuis src/lib (pas d'import cross TS/mjs dans ce repo, même
// contrainte que scripts/audit/create-fixture-client.mjs) ───────────────────
const CGU_VERSION = '2026-08-2'; // src/lib/legal.ts

function normalizePhone(raw) {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+33' + digits.slice(1);
  if (digits.startsWith('33')) return '+' + digits;
  return digits;
}

// src/lib/booking-utils.ts:380 — seuils réels, ne jamais les réimplémenter
// autrement ici (c'est exactement la duplication qui a permis un vrai écart
// prix/dépôt de passer inaperçu jusqu'au 27/07, voir commentaire
// stripe/checkout/route.ts). Garder synchronisé si le barème change.
function calcFraisGestion(servicePrice) {
  if (servicePrice > 100) return 2.5;
  if (servicePrice > 80) return 2.3;
  if (servicePrice > 50) return 2.1;
  return 1.99;
}

function generateQrCode() {
  let r = '';
  for (let i = 0; i < 6; i++) r += Math.floor(Math.random() * 10);
  return r;
}

function todayParisStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── Config par métier ────────────────────────────────────────────────────
const METIERS = {
  animaux: {
    category: 'animaux',
    type: 'toiletteur',
    name: 'Toilettage Xoko',
    city: 'Anglet',
    address: '12 avenue de Biarritz',
    postalCode: '64600',
    lat: 43.4832,
    lng: -1.5223,
    services: [
      { name: 'Toilettage complet', price: 45, deposit: 10, duration: 60 },
      { name: 'Toilettage simple', price: 25, deposit: 8, duration: 30 },
    ],
  },
  'tatouage-piercing': {
    category: 'tatouage-piercing',
    type: 'tatoueur',
    name: 'Studio Aitzina',
    city: 'Bayonne',
    address: '5 rue des Faures',
    postalCode: '64100',
    lat: 43.4933,
    lng: -1.4748,
    services: [
      { name: 'Tatouage (petite pièce)', price: 90, deposit: 15, duration: 60 },
      { name: 'Piercing', price: 35, deposit: 10, duration: 20 },
    ],
  },
};

const metierArg = process.argv.find((a) => a.startsWith('--metier='))?.split('=')[1];
if (!metierArg || !METIERS[metierArg]) {
  console.error(`--metier requis, une valeur parmi : ${Object.keys(METIERS).join(', ')}`);
  process.exit(1);
}
const metier = METIERS[metierArg];

// Slug fixe (pas dérivé du métier) : le même établissement démo change
// d'identité selon --metier au lieu de créer une nouvelle fiche à chaque
// bascule — un compte pro n'a qu'un seul biz_id (app_users.biz_id, colonne
// unique, voir src/app/(pro)/pro/page.tsx). Préfixe fixture-pro- : visible
// uniquement par les testeurs whitelistés (isFixtureBusiness,
// business-helpers.ts), jamais dans le catalogue public.
const BIZ_SLUG = 'fixture-pro-demo-visite';

const PRO_EMAIL = 'demo-pro@book-n-pay.invalid';
const CLIENT_EMAIL = 'demo-client@book-n-pay.invalid';
const CLIENT2_EMAIL = 'demo-client-2@book-n-pay.invalid'; // second client, contraste Standard

const CLIENT_NAME = '[DÉMO] Ainhoa Larralde';
const CLIENT_PHONE = normalizePhone('0699999991');
const CLIENT2_NAME = '[DÉMO] Julien Dupuy';
const CLIENT2_PHONE = normalizePhone('0699999992');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (via --env-file, jamais en dur).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers compte auth (idempotents : trouve ou crée) ──────────────────────
async function findAuthUserByEmail(email) {
  // L'admin API ne propose pas de lookup direct par email — pagination sur
  // la liste, acceptable ici (nombre de comptes auth encore modeste).
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureAuthUser(email, name, phone) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return existing;
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password: randomUUID(), // jamais affiché ni loggué — connexion uniquement via lien recovery
    email_confirm: true,
    user_metadata: { name, phone },
  });
  if (error) throw error;
  console.log(`  Compte auth créé : ${email} (${created.user.id})`);
  return created.user;
}

// ── 1. Comptes ────────────────────────────────────────────────────────────
console.log(`Préparation démo-visite — métier: ${metierArg} (${metier.name})`);

const proUser = await ensureAuthUser(PRO_EMAIL, '[DÉMO] Compte professionnel', null);
const clientUser = await ensureAuthUser(CLIENT_EMAIL, CLIENT_NAME, CLIENT_PHONE);
const client2User = await ensureAuthUser(CLIENT2_EMAIL, CLIENT2_NAME, CLIENT2_PHONE);

await supabase.from('app_users').upsert(
  { id: clientUser.id, name: CLIENT_NAME, phone: CLIENT_PHONE, role: 'client', onboarding_done: true, cgu_accepted_at: new Date().toISOString(), cgu_version: CGU_VERSION },
  { onConflict: 'id' }
);
await supabase.from('app_users').upsert(
  { id: client2User.id, name: CLIENT2_NAME, phone: CLIENT2_PHONE, role: 'client', onboarding_done: true, cgu_accepted_at: new Date().toISOString(), cgu_version: CGU_VERSION },
  { onConflict: 'id' }
);

// ── 2. Établissement ─────────────────────────────────────────────────────
const { data: existingBiz } = await supabase.from('businesses').select('id').eq('slug', BIZ_SLUG).maybeSingle();

let bizId = existingBiz?.id;
const bizPayload = {
  slug: BIZ_SLUG,
  name: metier.name,
  city: metier.city,
  category: metier.category,
  type: metier.type,
  owner_id: proUser.id,
  frozen: false,
  is_published: true,
  open_time: '09:00',
  close_time: '19:00',
  open_days: [1, 2, 3, 4, 5, 6],
};

if (bizId) {
  await supabase.from('businesses').update(bizPayload).eq('id', bizId);
  console.log(`  Établissement mis à jour : ${metier.name} (${bizId})`);
} else {
  const { data: created, error } = await supabase.from('businesses').insert(bizPayload).select('id').single();
  if (error) throw error;
  bizId = created.id;
  console.log(`  Établissement créé : ${metier.name} (${bizId})`);
}

await supabase.from('app_users').update({ role: 'pro', biz_id: bizId, onboarding_done: true }).eq('id', proUser.id);

await supabase.from('business_locations').upsert(
  { biz_id: bizId, address: metier.address, postal_code: metier.postalCode, lat: metier.lat, lng: metier.lng, address_public: true },
  { onConflict: 'biz_id' }
);

await supabase.from('business_settings').upsert(
  {
    biz_id: bizId,
    stripe_onboarding_complete: true,
    plan_key: 'starter',
    subscription_status: 'active',
  },
  { onConflict: 'biz_id' }
);

// ── 3. Remise à zéro des réservations de cet établissement ─────────────────
// AVANT la purge des prestations, pas après : bookings.service_id référence
// services.id (FK) — supprimer les prestations en premier fait échouer le
// DELETE silencieusement (erreur jamais vérifiée avant le 20/08, bug réel
// trouvé en parcours navigateur : services dupliqués à chaque bascule de
// métier, l'ancien service restait "accroché" par une réservation encore
// vivante). Purger les réservations d'abord lève la contrainte.
const { data: oldBookings } = await supabase.from('bookings').select('id').eq('biz_id', bizId);
const oldBookingIds = (oldBookings || []).map((b) => b.id);
if (oldBookingIds.length > 0) {
  await supabase.from('booking_members').delete().in('booking_id', oldBookingIds);
  await supabase.from('booking_logs').delete().in('booking_id', oldBookingIds);
  await supabase.from('bookings').delete().in('id', oldBookingIds);
  console.log(`  ${oldBookingIds.length} ancienne(s) réservation(s) purgée(s)`);
}

// Prestations : purge puis recrée (plus simple et plus sûr qu'un diff quand
// on bascule de métier — évite de laisser une ancienne prestation du métier
// précédent orpheline). Erreur de delete désormais vérifiée explicitement —
// un échec silencieux ici est exactement ce qui a produit les doublons.
const { error: deleteServicesError } = await supabase.from('services').delete().eq('biz_id', bizId);
if (deleteServicesError) throw deleteServicesError;
const { data: insertedServices, error: servicesError } = await supabase
  .from('services')
  .insert(metier.services.map((s) => ({ biz_id: bizId, name: s.name, allow_group: false, duration_minutes: s.duration, deposit: s.deposit, price: s.price })))
  .select('id, name, price, deposit, duration_minutes');
if (servicesError) throw servicesError;
console.log(`  ${insertedServices.length} prestation(s) : ${insertedServices.map((s) => s.name).join(', ')}`);

// ── 4. Création des réservations réelles (RPC réelle, voir en-tête) ────────
async function createBooking({ service, date, time, clientId, clientPhone, clientName, clientEmail }) {
  const { data, error } = await supabase.rpc('create_solo_booking_with_overlap_check', {
    p_biz_id: bizId,
    p_biz_name: metier.name,
    p_service_id: service.id,
    p_service_name: service.name,
    p_date: date,
    p_time: time,
    p_client_id: clientId,
    p_client_phone: clientPhone,
    p_client_name: clientName,
    p_client_email: clientEmail,
    p_group_ref: null,
    p_payment_deadline: null,
  });
  if (error) throw error;
  const booking = (data ?? [])[0];
  if (!booking) throw new Error(`Créneau ${date} ${time} déjà occupé (chevauchement) — ajuster l'horaire dans le script.`);
  return booking;
}

async function addMember({ bookingId, name, phone, email, status }) {
  const deposit = null; // posé juste après selon la prestation, voir appels
  const { error } = await supabase.from('booking_members').insert({
    booking_id: bookingId,
    name,
    phone,
    email,
    status,
    qr_code: generateQrCode(),
    is_demo: false,
  });
  if (error) throw error;
}

// Montant réellement encaissé (dépôt + frais de gestion, barème réel) —
// stocké sur booking_members.deposit comme le fait le webhook Stripe réel
// (route.ts, `deposit: dep`) : dep = montant TOTAL débité, pas seulement le
// dépôt du service.
function totalCollected(service) {
  return Math.round((service.deposit + calcFraisGestion(service.price)) * 100) / 100;
}

const [svcA, svcB] = insertedServices;

// -- Filler clients (aujourd'hui) : agenda du jour rempli, invités "guest"
// (client_id null), exactement comme un vrai visiteur non connecté qui
// réserve — aucun compte auth nécessaire pour eux.
const FILLERS = [
  { name: 'Maialen Etcheverry', phone: normalizePhone('0611111101') },
  { name: 'Peio Iribarne', phone: normalizePhone('0611111102') },
  { name: 'Sophie Duprat', phone: normalizePhone('0611111103') },
];

const today = todayParisStr(0);
const now = new Date();
const nowHour = now.getHours();

// Deux créneaux déjà "arrivés" plus tôt dans la journée si l'heure actuelle
// le permet, sinon ils tombent simplement dans le passé de la journée en
// cours — cosmétique, sans risque (statut déjà terminal, le cron
// check-no-shows ignore tout ce qui n'est pas 'paid').
const arrivedSlots = ['10:00:00', '11:30:00'];
for (let i = 0; i < 2; i++) {
  const f = FILLERS[i];
  const b = await createBooking({
    service: i === 0 ? svcA : svcB,
    date: today,
    time: arrivedSlots[i],
    clientId: null,
    clientPhone: f.phone,
    clientName: f.name,
    clientEmail: null,
  });
  await addMember({ bookingId: b.id, name: f.name, phone: f.phone, email: null, status: 'arrived' });
  const svc = i === 0 ? svcA : svcB;
  await supabase.from('booking_members').update({ deposit: totalCollected(svc) }).eq('booking_id', b.id);
}

// Un créneau plus tard dans la journée, encore 'paid' (à venir aujourd'hui,
// donc jamais rattrapable par le cron no-show tant que l'heure n'est pas
// passée) — seulement si l'heure actuelle laisse la place à un créneau
// futur avant fermeture (19:00) ; sinon ce filler est simplement omis pour
// cette exécution (pas d'erreur, juste un agenda un peu moins rempli).
if (nowHour < 18) {
  const f = FILLERS[2];
  const laterHour = Math.max(nowHour + 2, 15);
  const time = `${String(Math.min(laterHour, 18)).padStart(2, '0')}:00:00`;
  const b = await createBooking({
    service: svcA,
    date: today,
    time,
    clientId: null,
    clientPhone: f.phone,
    clientName: f.name,
    clientEmail: null,
  });
  await addMember({ bookingId: b.id, name: f.name, phone: f.phone, email: null, status: 'paid' });
  await supabase.from('booking_members').update({ deposit: totalCollected(svcA) }).eq('booking_id', b.id);
}

// -- No-show récent, non traité : un autre filler, hier, statut posé
// directement à 'no_show' (raccourci #2 en en-tête) — AUCUNE ligne
// booking_logs ni notifyProNoShow/sendEmail simulés ici, pour ne jamais
// déclencher le vrai chemin d'emailing. "Non traité" = aucune décision
// enregistrée sur le geste commercial, ce qui est déjà l'état par défaut
// (voir dette handleKeepFees, mémoire projet) : rien de plus à poser.
{
  const f = { name: 'Xabi Cazenave', phone: normalizePhone('0611111104') };
  const b = await createBooking({
    service: svcB,
    date: todayParisStr(-1),
    time: '14:00:00',
    clientId: null,
    clientPhone: f.phone,
    clientName: f.name,
    clientEmail: null,
  });
  await addMember({ bookingId: b.id, name: f.name, phone: f.phone, email: null, status: 'no_show' });
  await supabase.from('booking_members').update({ deposit: totalCollected(svcB) }).eq('booking_id', b.id);
}

// -- Client démo principal (Ainhoa Larralde / demo-client) : 1 RDV honoré
// réel récent (pour que get_client_loyalty_for_pro trouve un lien réel),
// + 2 RDV à venir (un à annuler en démo, un qui reste "à venir" ensuite).
{
  const b1 = await createBooking({
    service: svcA,
    date: todayParisStr(-3),
    time: '10:00:00',
    clientId: clientUser.id,
    clientPhone: CLIENT_PHONE,
    clientName: CLIENT_NAME,
    clientEmail: CLIENT_EMAIL,
  });
  await addMember({ bookingId: b1.id, name: CLIENT_NAME, phone: CLIENT_PHONE, email: CLIENT_EMAIL, status: 'arrived' });
  await supabase.from('booking_members').update({ deposit: totalCollected(svcA) }).eq('booking_id', b1.id);

  for (const [offset, time] of [[2, '11:00:00'], [5, '16:00:00']]) {
    const b = await createBooking({
      service: svcB,
      date: todayParisStr(offset),
      time,
      clientId: clientUser.id,
      clientPhone: CLIENT_PHONE,
      clientName: CLIENT_NAME,
      clientEmail: CLIENT_EMAIL,
    });
    await addMember({ bookingId: b.id, name: CLIENT_NAME, phone: CLIENT_PHONE, email: CLIENT_EMAIL, status: 'paid' });
    await supabase.from('booking_members').update({ deposit: totalCollected(svcB) }).eq('booking_id', b.id);
  }
}

// -- Second client démo (Julien Dupuy / demo-client-2) : contraste Standard,
// 1 seul RDV honoré réel récent.
{
  const b = await createBooking({
    service: svcA,
    date: todayParisStr(-7),
    time: '09:30:00',
    clientId: client2User.id,
    clientPhone: CLIENT2_PHONE,
    clientName: CLIENT2_NAME,
    clientEmail: CLIENT2_EMAIL,
  });
  await addMember({ bookingId: b.id, name: CLIENT2_NAME, phone: CLIENT2_PHONE, email: CLIENT2_EMAIL, status: 'arrived' });
  await supabase.from('booking_members').update({ deposit: totalCollected(svcA) }).eq('booking_id', b.id);
}

// ── 5. Fidélité (raccourci #3 en en-tête) ───────────────────────────────────
// demo-client : Bronze crédible (18-30 = Bronze, booking-utils.ts TIERS),
// un joker déjà utilisé pour que le compteur ne soit pas à zéro.
await supabase
  .from('app_users')
  .update({ statut: 'Bronze', rdv_honores: 19, jokers_disponibles: 1, jokers_utilises: 1, derniere_activite: todayParisStr(-3) })
  .eq('id', clientUser.id);

// demo-client-2 : Standard, contraste — nouveau client, peu de RDV.
await supabase
  .from('app_users')
  .update({ statut: 'Standard', rdv_honores: 3, jokers_disponibles: 1, jokers_utilises: 0, derniere_activite: todayParisStr(-7) })
  .eq('id', client2User.id);

console.log('');
console.log(`Démo prête — ${metier.name} (${metierArg}), biz_id=${bizId}`);
console.log(`Connexion pro    : node scripts/audit/passwordless-login-link.mjs ${PRO_EMAIL}`);
console.log(`Connexion client : node scripts/audit/passwordless-login-link.mjs ${CLIENT_EMAIL}`);
console.log('');
console.log('⚠️  Vérifier que DEMO_TESTER_EMAILS (Vercel + .env.local) contient bien :');
console.log(`    ${PRO_EMAIL}, ${CLIENT_EMAIL}`);
console.log('    (nécessaire pour que /recherche affiche les 1000 fiches génériques à ces deux comptes)');
