// src/lib/database.types.ts
// Types générés manuellement depuis supabase/migrations/0001_schema.sql
// (à terme, remplacer par `supabase gen types typescript` une fois le projet lié en CLI)

export type UserRole = 'admin' | 'pro' | 'client';
export type LoyaltyStatus = 'Standard' | 'Bronze' | 'Argent' | 'Gold';
// ⚠️ 'completed' = tous les membres actifs sont passés 'paid' (dépôt réglé),
// PAS "prestation rendue" — ce champ bascule au moment du paiement, pas du
// service. Pour savoir si un RDV a réellement eu lieu, lire
// MemberStatus==='arrived' (posé par check-in QR ou cloturer-prestation),
// jamais BookingStatus. Vérifié le 17/07 : aucun consommateur du repo ne
// fait cette confusion (fidélité/avis/no-show/stats lisent tous
// MemberStatus) — piège documenté ici pour qu'il ne soit pas réintroduit,
// pas parce qu'un bug existe aujourd'hui.
export type BookingStatus = 'active' | 'cancelled' | 'completed';
export type MemberStatus = 'invite' | 'paid' | 'arrived' | 'no_show' | 'cancelled';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface AppUser {
  id: string;
  name: string;
  phone: string | null;
  role: UserRole;
  biz_id: string | null;
  onboarding_done: boolean;
  rdv_honores: number;
  statut: LoyaltyStatus;
  jokers_disponibles: number;
  jokers_utilises: number;
  derniere_activite: string | null;
  referral_code: string | null;
  referred_by: string | null;
  referral_reward_granted: boolean;
  pending_referral_discount_pct: number;
  referral_discounts_available: number;
  free_management_fees_available: number;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  city: string;
  category: string;
  type: string;
  instagram: string | null;
  facebook_url: string | null;
  website: string | null;
  phone: string | null;
  google_place_url: string | null;
  google_place_id: string | null;
  open_time: string | null;
  close_time: string | null;
  open_days: number[];
  pro_code: string | null;
  owner_id: string | null;
  frozen: boolean;
  frozen_reason: string | null;
  is_published: boolean;
  service_area_radius_km: number | null;
  created_at: string;
  updated_at: string;
}

// Adresse géocodée (API adresse.data.gouv.fr) — table séparée business_locations
// (migration 0037), jamais fusionnée dans Business : address_public=false doit
// pouvoir masquer address/lat/lng au public via RLS, ce qu'une colonne sur
// businesses ne permet pas (RLS filtre des lignes, pas des colonnes).
export interface BusinessLocation {
  biz_id: string;
  address: string;
  postal_code: string;
  lat: number;
  lng: number;
  address_public: boolean;
  created_at: string;
}

export interface BusinessPhoto {
  id: string;
  biz_id: string;
  url: string;
  sort_order: number;
  created_at: string;
}

export interface Staff {
  id: string;
  biz_id: string;
  name: string;
  role: string | null;
  emoji: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  created_at: string;
}

export interface StaffSchedule {
  id: string;
  staff_id: string;
  biz_id: string;
  day_of_week: number; // 0=Dim, 1=Lun…6=Sam (JS getDay() convention)
  open_time: string;
  close_time: string;
  created_at: string;
}

export interface Service {
  id: string;
  biz_id: string;
  name: string;
  genre: string | null;
  allow_group: boolean;
  duration_minutes: number;
  deposit: number;
  price: number;
  max_persons: number | null;
  created_at: string;
}

export interface Booking {
  id: string;
  biz_id: string;
  service_id: string;
  staff_id: string | null;
  biz_name: string;
  service_name: string;
  staff_name: string | null;
  date: string;
  time: string;
  status: BookingStatus;
  group_ref: string | null;
  payment_deadline: string | null;
  organizer_token: string;
  client_id: string | null;
  client_phone: string | null;
  client_name: string | null;
  client_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingMember {
  id: string;
  booking_id: string;
  member_ref: string | null;
  name: string;
  phone: string | null;
  status: MemberStatus;
  deposit: number | null;
  qr_code: string | null;
  is_referral: boolean;
  client_msg: string | null;
  joker_applique: boolean;
  montant_rembourse: number | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  email: string | null;
  invite_expiry: string | null;
  payment_mode: 'app' | 'tpe' | 'especes' | null;
  referrer_name: string | null;
  referral_discount_pct: number;
  paid_by_member_id: string | null;
  paid_for_at: string | null;
  post_visit_popup_shown: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingLog {
  id: string;
  booking_id: string;
  message: string;
  created_at: string;
}

export interface BusinessSettings {
  biz_id: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  stripe_onboarding_url: string | null;
  notification_prefs: Record<string, boolean>;
  updated_at: string;
  // Migration 0015 — facturation abonnements pro
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_key: 'starter' | 'business' | 'scale';
  payment_method_type: 'card' | 'sepa_debit' | null;
  stripe_payment_method_id: string | null;
  subscription_status: 'pending' | 'active' | 'past_due' | 'cancelled';
  subscription_start_date: string | null;
  engagement_end_date: string | null;
  next_billing_date: string | null;
  monthly_bookings_count: number;
  bookings_count_reset_at: string;
}

export interface BusinessReview {
  biz_id: string;
  rating: number | null;
  review_count: number;
  google_place_id: string | null;
  last_sync: string | null;
}

export interface FlashSlot {
  id: string;
  biz_id: string;
  biz_name: string;
  service_id: string | null;
  service_name: string | null;
  date: string;
  time: string;
  original_deposit: number | null;
  flash_deposit: number | null;
  booking_id: string | null;
  active: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  booking_id: string;
  sender_role: 'client' | 'pro';
  sender_name: string | null;
  text: string;
  read_by_client: boolean;
  read_by_pro: boolean;
  created_at: string;
}

export interface Favorite {
  id: string;
  user_id: string;
  biz_id: string;
  created_at: string;
}

export interface PartnerApplication {
  id: string;
  etablissement: string;
  gerant: string;
  email: string;
  phone: string | null;
  google_maps_url: string | null;
  instagram: string | null;
  website: string | null;
  stripe_connected: boolean;
  stripe_account_id: string | null;
  creneaux: { jour: string; ouverture: string; fermeture: string }[] | null;
  status: ApplicationStatus;
  admin_note: string | null;
  created_at: string;
  // Migration 0016 + 0018
  category: 'beaute' | 'bien-etre' | 'sport' | 'sante' | 'soins-corps' | 'coiffure-barber'
    | 'tatouage-piercing' | 'coaching' | 'animaux' | 'beaute-domicile' | 'photographie' | 'autre';
  category_label: string | null;
  type: string | null;
  monthly_bookings_estimate: '0-80' | '81-300' | '300+';
  approved_at: string | null;
}

export interface AppConfig {
  key: string;
  value: string;
  label: string | null;
  description: string | null;
  updated_at: string;
}

export interface ReferralEvent {
  id: string;
  referrer_id: string;
  referred_id: string;
  triggered_at: string;
  parrain_discount_consumed: boolean;
  parrain_discount_consumed_at: string | null;
  created_at: string;
}

export interface EnrichedReferralEvent extends ReferralEvent {
  referred?: {
    id: string;
    name: string;
    rdv_honores: number;
    referral_reward_granted: boolean;
  } | null;
}

// Vue composée utile côté front : une réservation avec ses membres chargés
export interface BookingWithMembers extends Booking {
  booking_members: BookingMember[];
}
