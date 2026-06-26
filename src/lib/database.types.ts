// src/lib/database.types.ts
// Types générés manuellement depuis supabase/migrations/0001_schema.sql
// (à terme, remplacer par `supabase gen types typescript` une fois le projet lié en CLI)

export type UserRole = 'admin' | 'pro' | 'client';
export type LoyaltyStatus = 'Standard' | 'Bronze' | 'Argent' | 'Gold';
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
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  biz_id: string;
  name: string;
  role: string | null;
  emoji: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  biz_id: string;
  name: string;
  genre: string | null;
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

// Vue composée utile côté front : une réservation avec ses membres chargés
export interface BookingWithMembers extends Booking {
  booking_members: BookingMember[];
}
