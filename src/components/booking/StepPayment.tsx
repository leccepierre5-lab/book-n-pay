'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';
import { calcFraisGestion, normalizePhone, isSlotPast } from '@/lib/booking-utils';
import { createClient } from '@/lib/supabase/client';
import { isNonRealBusiness } from '@/lib/business-helpers';

// Contact Picker API — Chrome Android 80+, absent sur Safari iOS et desktop.
type ContactRecord = { name?: string[]; tel?: string[] };
type ContactsManager = {
  select(props: string[], opts?: { multiple?: boolean }): Promise<ContactRecord[]>;
};
declare global { interface Navigator { contacts?: ContactsManager } }

function useContactPicker() {
  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported('contacts' in navigator); }, []);

  const pick = async (maxCount: number): Promise<ContactRecord[]> => {
    if (!navigator.contacts) return [];
    try {
      const results = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      // Silently truncate if user selected more contacts than there are participant slots
      return results.slice(0, maxCount);
    } catch { return []; }
  };

  return { supported, pick };
}

// Icône "carnet de contacts" réutilisée dans les deux modes
function ContactsIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25S13.24 11.25 12 11.25 9.75 10.24 9.75 9s1.01-2.25 2.25-2.25zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z"/>
    </svg>
  );
}

type PayMode = 'a' | 'b' | null;

interface GuestInfo {
  name: string;
  phone: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RecapBox({
  service, business, staff, date, slots, participants, staffChoices,
}: {
  service: Service; business: BusinessWithDetails; staff: Staff | null;
  date: string; slots: string[]; participants: number; staffChoices: (string | null)[];
}) {
  const slotsLabel = slots.length > 1 ? slots.join(' → ') : slots[0];
  // CAS 2 uniquement (service individuel multi-praticiens) : un praticien
  // par personne au lieu d'un praticien unique pour tout le groupe. À ce
  // stade (avant la création des réservations), on affiche le CHOIX de
  // chacun (précis ou "peu importe") — pas l'assignation réelle, qui n'est
  // tranchée qu'à la création (assign_staff_and_create_booking), voir
  // CONCEPTION_CAS2_STAFF_GROUPE.md étape 4.
  const showPerPersonStaff = service.allow_group !== true && participants > 1 && staffChoices.length === participants;

  return (
    <div className="rounded-2xl bg-navy-900 border border-white/[0.08] px-4 py-4 mb-5">
      <p className="text-sm font-semibold text-white mb-2">
        Prestation : <span className="text-white/80">{service.name}</span>
      </p>
      <p className="text-sm text-slate-400 mb-1">
        Date : <span className="text-white/80 font-medium">{date} à {slots[0]}</span>
      </p>
      {staff && (
        <p className="text-sm text-slate-400 mb-1">
          Praticien : <span className="text-white/80">{staff.name}</span>
        </p>
      )}
      {participants > 1 && (
        <p className="text-sm text-slate-400">
          Personnes : <strong className="text-white">{participants}</strong>
          {slots.length > 1 && (
            <span className="text-slate-500 ml-2">· {slotsLabel}</span>
          )}
        </p>
      )}
      {showPerPersonStaff && (
        <div className="mt-2 space-y-1">
          {staffChoices.map((choice, i) => {
            const chosen = choice ? business.staff.find((s) => s.id === choice) : null;
            return (
              <p key={i} className="text-xs text-slate-500">
                {i === 0 ? 'Vous' : `Personne ${i + 1}`} :{' '}
                <span className="text-slate-300">
                  {chosen ? `${chosen.emoji ?? ''} ${chosen.name}`.trim() : '🎲 Peu importe'}
                </span>
              </p>
            );
          })}
        </div>
      )}
      {participants > 1 && (
        <p className="text-sm text-emerald-400 font-medium mt-1">
          Frais de réservation par personne : {service.deposit}€
        </p>
      )}
    </div>
  );
}

function ModeSelection({
  service, participants, onSelect, hideModeB,
}: {
  service: Service; participants: number; onSelect: (m: PayMode) => void; hideModeB?: boolean;
}) {
  const total = service.deposit * participants;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-white mb-4">Comment souhaitez-vous régler ?</p>

      {/* Mode A */}
      <button
        onClick={() => onSelect('a')}
        className="w-full text-left rounded-2xl bg-navy-900 border border-white/[0.08] p-4 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-200"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white">Je paye pour tout le monde</p>
            <p className="text-xs text-emerald-400 font-medium mt-0.5">
              Total : {total}€ ({participants} × {service.deposit}€)
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Chacun reçoit son QR code individuel. Vous vous arrangez entre vous.
            </p>
          </div>
        </div>
      </button>

      {/* Mode B — masqué en mode démo (fiche sans propriétaire réel) :
          un lien d'invitation n'a rien de persistant à quoi pointer sans
          écriture en base, voir bookings/create-group/route.ts. */}
      {!hideModeB && (
        <button
          onClick={() => onSelect('b')}
          className="w-full text-left rounded-2xl bg-navy-900 border border-white/[0.08] p-4 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all duration-200"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Partager un lien à chaque personne</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Vous payez <strong className="text-white">{service.deposit}€</strong> maintenant,
                les autres reçoivent un lien pour payer le leur.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Fonctionne via WhatsApp, SMS ou n'importe quelle messagerie.
              </p>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

// ── Mode A: pay for all ───────────────────────────────────────────────────────

function ModeAPayment({
  service, business, staff, date, slots, participants, staffChoices,
  onBack,
}: {
  service: Service; business: BusinessWithDetails; staff: Staff | null;
  date: string; slots: string[]; participants: number; staffChoices: (string | null)[];
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [guestNames, setGuestNames] = useState<string[]>(Array(participants).fill(''));
  const [showNames, setShowNames] = useState(false);
  const { supported: contactsSupported, pick: pickContacts } = useContactPicker();

  const depositPerPerson = service.deposit;
  const totalDeposit = depositPerPerson * participants;
  const fraisGestion = calcFraisGestion(service.price);
  const totalNow = totalDeposit + fraisGestion;
  const slotsLabel = slots.length > 1 ? slots.join(' → ') : slots[0];

  const handlePay = async () => {
    if (!accepted) return;
    if (slots.some((s) => isSlotPast(date, s))) {
      setError('Un ou plusieurs créneaux sont déjà passés. Merci de retourner en arrière et de choisir un autre horaire.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('app_users')
        .select('name, phone, pending_referral_discount_pct, referral_discounts_available')
        .eq('id', authData.user?.id || '')
        .maybeSingle();

      // Create all bookings (one per slot)
      const createRes = await fetch('/api/bookings/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizId: business.id,
          bizName: business.name,
          serviceId: service.id,
          serviceName: service.name,
          staffId: staff?.id,
          staffName: staff?.name,
          date,
          slots,
          staffChoices: staffChoices.length > 0 ? staffChoices : undefined,
          guestNames: guestNames.map((n, i) => n || (i === 0 ? profile?.name || 'Vous' : `Personne ${i + 1}`)),
          mode: 'a',
          clientName: profile?.name || authData.user?.email || 'Client',
          clientPhone: profile?.phone || '',
          clientEmail: authData.user?.email || '',
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || createData.error) throw new Error(createData.error || 'Erreur création réservation');

      const { groupRef, primaryBookingId, primaryMemberId, allMemberIds } = createData;
      const isDemo = !!createData.demo;

      // Single Stripe checkout for N × deposit + fraisGestion
      const discountPct: number = (profile?.referral_discounts_available || 0) > 0
        ? 20
        : (profile?.pending_referral_discount_pct || 0);
      const ratio = discountPct > 0 ? (1 - discountPct / 100) : 1;
      const effectiveDepositPerPerson = Math.round(depositPerPerson * ratio * 100) / 100;

      // Mode démo — même raisonnement que SoloPayment : rien écrit en base,
      // confirmation reconstruite depuis les query params.
      const successUrl = isDemo
        ? `${window.location.origin}/confirmation?demo=1&biz=${encodeURIComponent(business.name)}&service=${encodeURIComponent(service.name)}&date=${date}&slots=${encodeURIComponent(slots.join(','))}&participants=${participants}${staff?.name ? `&staff=${encodeURIComponent(staff.name)}` : ''}`
        : `${window.location.origin}/confirmation?booking=${primaryBookingId}`;

      const checkoutRes = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveDepositPerPerson,
          quantity: participants,
          clientUserId: authData.user?.id || '',
          bookingMeta: {
            bookingId: isDemo ? '' : primaryBookingId,
            memberId: isDemo ? '' : primaryMemberId,
            groupRef: isDemo ? '' : groupRef,
            allMemberIds: (allMemberIds || []).join(','),
            bizId: business.id,
            bizName: business.name,
            serviceName: service.name,
            date,
            time: slots[0],
            clientName: profile?.name || '',
            clientPhone: profile?.phone || '',
            clientEmail: authData.user?.email || '',
            isDemo,
          },
          successUrl,
          cancelUrl: window.location.href,
        }),
      });
      const { url, error: checkoutError } = await checkoutRes.json();
      if (checkoutError) throw new Error(checkoutError);
      window.location.href = url;
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-5 transition-colors">
        ← Retour
      </button>

      {/* Recap */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] px-4 py-4 mb-4">
        <p className="text-sm font-bold text-white mb-2">Récapitulatif</p>
        <p className="text-sm text-slate-400">Prestation : <span className="text-white">{service.name}</span></p>
        <p className="text-sm text-slate-400">Date : <span className="text-white">{date} à {slots[0]}</span></p>
        {staff && <p className="text-sm text-slate-400">Praticien : <span className="text-white">{staff.name}</span></p>}
        <p className="text-sm text-slate-400">
          Personnes : <strong className="text-white">{participants}</strong>
          {slots.length > 1 && <span className="text-slate-500 ml-2">· {slotsLabel}</span>}
        </p>
      </div>

      {/* Contact picker — Mode A (noms seulement, Chrome Android) */}
      {contactsSupported && (
        <button
          type="button"
          onClick={async () => {
            const contacts = await pickContacts(participants);
            if (contacts.length === 0) return;
            setGuestNames((prev) => {
              const next = [...prev];
              contacts.forEach((c, i) => { if (c.name?.[0]) next[i] = c.name[0]; });
              return next;
            });
            setShowNames(true);
          }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.98] transition-all mb-4"
        >
          <ContactsIcon />
          Importer depuis mes contacts
        </button>
      )}

      {/* Optional names accordion */}
      <button
        onClick={() => setShowNames(!showNames)}
        className="w-full rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 flex items-center justify-between mb-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
          Noms des participants (optionnel)
        </div>
        <span className="text-slate-500 text-sm">{showNames ? '▲' : '▼'}</span>
      </button>

      {showNames && (
        <div className="rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 mb-4 space-y-3">
          {Array.from({ length: participants }).map((_, i) => (
            <div key={i}>
              <p className="text-[11px] text-slate-500 mb-1">
                Créneau {slots[i] || slots[0]} {i === 0 ? '(vous)' : ''}
              </p>
              <input
                type="text"
                placeholder={i === 0 ? 'Votre prénom' : 'Prénom (optionnel)'}
                value={guestNames[i]}
                onChange={(e) => setGuestNames((prev) => {
                  const n = [...prev]; n[i] = e.target.value; return n;
                })}
                className="w-full rounded-xl bg-navy-800 border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
              />
            </div>
          ))}
        </div>
      )}

      {/* Payment summary */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] px-4 py-4 mb-5">
        <p className="text-sm font-bold text-white mb-3">Récapitulatif du paiement</p>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-white">{service.name}</p>
              <p className="text-xs text-slate-500">{participants} personnes × {depositPerPerson}€</p>
            </div>
            <span className="text-sm font-semibold text-white">{(depositPerPerson * participants).toFixed(0)}€</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1">
              <span className="text-emerald-400 text-sm">☑</span>
              <div>
                <p className="text-xs text-white">Réglé maintenant (sécurisé)</p>
                <p className="text-[10px] text-slate-500">Frais de réservation × {participants} · déduit sur place</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-emerald-400">-{totalDeposit.toFixed(0)}€</span>
          </div>
          <div className="h-px bg-white/[0.06]" />
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Frais de gestion</span>
            <span className="text-xs text-slate-300">{fraisGestion.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm font-bold text-white">Total débité maintenant</span>
            <span className="text-lg font-bold text-emerald-400">{totalNow.toFixed(2)}€</span>
          </div>
        </div>
      </div>

      {/* CGV checkbox */}
      <label className="flex items-start gap-3 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-emerald-500 shrink-0"
        />
        <p className="text-xs text-slate-400">
          J'accepte les{' '}
          <Link href="/cgu" className="text-slate-300 underline underline-offset-2">CGV</Link>{' '}
          incluant les frais de réservation et les frais de gestion de {fraisGestion.toFixed(2)}€.
        </p>
      </label>

      {error && (
        <div className="mb-4 rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={loading || !accepted}
        className="w-full rounded-2xl py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        style={!loading && accepted ? {
          background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: '0 4px 24px rgba(52,211,153,0.4)',
          color: '#0a1224',
        } : { background: '#334155', color: '#94a3b8' }}
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Redirection...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Payer {totalNow.toFixed(2)}€ en sécurité
          </>
        )}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-600 flex items-center justify-center gap-1.5">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Paiement sécurisé par Stripe
      </p>
    </div>
  );
}

// ── Mode B: share links ───────────────────────────────────────────────────────

function ModeBPayment({
  service, business, staff, date, slots, participants, staffChoices,
  onBack,
}: {
  service: Service; business: BusinessWithDetails; staff: Staff | null;
  date: string; slots: string[]; participants: number; staffChoices: (string | null)[];
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [guests, setGuests] = useState<GuestInfo[]>(
    Array.from({ length: participants - 1 }, () => ({ name: '', phone: '' }))
  );
  const { supported: contactsSupported, pick: pickContacts } = useContactPicker();

  const fraisGestion = calcFraisGestion(service.price);
  const myTotal = service.deposit + fraisGestion;
  const allPhonesSet = guests.every((g) => g.phone.trim().length >= 10);

  const updateGuest = (idx: number, field: keyof GuestInfo, value: string) => {
    setGuests((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], [field]: value };
      return n;
    });
  };

  const handlePay = async () => {
    if (!accepted || !allPhonesSet) return;
    if (slots.some((s) => isSlotPast(date, s))) {
      setError('Un ou plusieurs créneaux sont déjà passés. Merci de retourner en arrière et de choisir un autre horaire.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('app_users')
        .select('name, phone, pending_referral_discount_pct, referral_discounts_available')
        .eq('id', authData.user?.id || '')
        .maybeSingle();

      // Create group bookings (organizer + guests)
      const normalizedGuests = guests.map((g) => ({
        name: g.name || undefined,
        phone: normalizePhone(g.phone),
      }));

      const createRes = await fetch('/api/bookings/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizId: business.id,
          bizName: business.name,
          serviceId: service.id,
          serviceName: service.name,
          staffId: staff?.id,
          staffName: staff?.name,
          date,
          slots,
          staffChoices: staffChoices.length > 0 ? staffChoices : undefined,
          guests: normalizedGuests,
          mode: 'b',
          clientName: profile?.name || authData.user?.email || 'Client',
          clientPhone: profile?.phone || '',
          clientEmail: authData.user?.email || '',
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || createData.error) throw new Error(createData.error || 'Erreur création');

      const { groupRef, primaryBookingId, primaryMemberId, guestMemberIds } = createData;

      // Stripe checkout for organizer only
      const discountPct: number = (profile?.referral_discounts_available || 0) > 0
        ? 20
        : (profile?.pending_referral_discount_pct || 0);
      const ratio = discountPct > 0 ? (1 - discountPct / 100) : 1;
      const effectiveDeposit = Math.round(service.deposit * ratio * 100) / 100;

      const checkoutRes = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveDeposit,
          quantity: 1,
          clientUserId: authData.user?.id || '',
          bookingMeta: {
            bookingId: primaryBookingId,
            memberId: primaryMemberId,
            groupRef,
            guestMemberIds: (guestMemberIds || []).join(','),
            bizId: business.id,
            bizName: business.name,
            serviceName: service.name,
            date,
            time: slots[0],
            clientName: profile?.name || '',
            clientPhone: profile?.phone || '',
            clientEmail: authData.user?.email || '',
          },
          successUrl: `${window.location.origin}/confirmation?booking=${primaryBookingId}&mode=b&guests=${encodeURIComponent((guestMemberIds || []).join(','))}`,
          cancelUrl: window.location.href,
        }),
      });
      const { url, error: checkoutError } = await checkoutRes.json();
      if (checkoutError) throw new Error(checkoutError);
      window.location.href = url;
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-5 transition-colors">
        ← Retour
      </button>

      {/* Info banner */}
      <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 px-4 py-3 mb-5">
        <p className="text-xs text-blue-300 font-semibold mb-1">Partage du lien d'invitation</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Après votre paiement, un lien sera partagé à chaque participant via le menu de partage de votre
          téléphone (WhatsApp, SMS…). Chacun paiera ses propres frais de réservation de{' '}
          <strong className="text-white">{service.deposit}€</strong>.
        </p>
      </div>

      {/* Organizer slot */}
      <div className="rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 mb-3">
        <p className="text-xs text-slate-500 mb-2">Créneau {slots[0]} (vous)</p>
        <div className="rounded-xl bg-navy-800 px-3 py-2">
          <p className="text-sm text-white/60 italic">Votre profil connecté</p>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Vous payez <strong className="text-white">{service.deposit}€</strong> de frais de réservation maintenant.
        </p>
      </div>

      {/* Contact picker — Mode B (nom + téléphone, Chrome Android) */}
      {contactsSupported && guests.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            const contacts = await pickContacts(guests.length);
            if (contacts.length === 0) return;
            setGuests((prev) => {
              const next = [...prev];
              contacts.forEach((c, i) => {
                if (c.tel?.[0]) next[i] = { ...next[i], phone: c.tel[0] };
                if (c.name?.[0] && !next[i].name) next[i] = { ...next[i], name: c.name[0] };
              });
              return next;
            });
          }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.98] transition-all mb-3"
        >
          <ContactsIcon />
          Importer depuis mes contacts
        </button>
      )}

      {/* Guest slots */}
      {guests.map((guest, idx) => (
        <div key={idx} className="rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 mb-3">
          <p className="text-xs text-slate-500 mb-2">
            Créneau {slots[idx + 1] || slots[0]}
          </p>
          <input
            type="text"
            placeholder="Prénom (optionnel)"
            value={guest.name}
            onChange={(e) => updateGuest(idx, 'name', e.target.value)}
            className="w-full rounded-xl bg-navy-800 border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40 mb-2"
          />
          <input
            type="tel"
            placeholder="Téléphone (obligatoire) *"
            value={guest.phone}
            onChange={(e) => updateGuest(idx, 'phone', e.target.value)}
            className="w-full rounded-xl bg-navy-800 border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
          />
        </div>
      ))}

      {/* Payment summary */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] px-4 py-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-slate-400">Frais de réservation</span>
          <span className="text-sm font-semibold text-white">{service.deposit}€</span>
        </div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Frais de gestion</span>
          <span className="text-sm text-slate-300">{fraisGestion.toFixed(2)}€</span>
        </div>
        <div className="h-px bg-white/[0.06] mb-3" />
        <div className="flex justify-between items-center">
          <span className="text-sm font-bold text-white">Total à payer</span>
          <span className="text-xl font-bold text-emerald-400">{myTotal.toFixed(2)}€</span>
        </div>
      </div>

      {/* CGV */}
      <label className="flex items-start gap-3 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-emerald-500 shrink-0"
        />
        <p className="text-xs text-slate-400">
          J'accepte les{' '}
          <Link href="/cgu" className="text-slate-300 underline underline-offset-2">CGV</Link>{' '}
          incluant les frais de réservation et les frais de gestion de {fraisGestion.toFixed(2)}€.
        </p>
      </label>

      {!allPhonesSet && guests.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 mb-3 flex items-center gap-2">
          <span className="text-amber-400 shrink-0 text-sm">⚠</span>
          <p className="text-xs text-amber-300">
            Renseignez le numéro de téléphone de chaque invité pour qu'ils puissent retrouver la réservation.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={loading || !accepted || !allPhonesSet}
        className="w-full rounded-2xl py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        style={!loading && accepted && allPhonesSet ? {
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          boxShadow: '0 4px 24px rgba(99,102,241,0.35)',
          color: '#ffffff',
        } : { background: '#334155', color: '#94a3b8' }}
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Redirection...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Payer {myTotal.toFixed(2)}€ et partager les liens
          </>
        )}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-600 flex items-center justify-center gap-1.5">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Paiement sécurisé par Stripe
      </p>
    </div>
  );
}

// ── Solo payment (1 person) ───────────────────────────────────────────────────

function SoloPayment({
  service, business, staff, date, time,
}: {
  service: Service; business: BusinessWithDetails; staff: Staff | null;
  date: string; time: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fraisGestion = calcFraisGestion(service.price);
  const total = service.deposit + fraisGestion;
  const solde = service.price - service.deposit;

  const handlePay = async () => {
    if (isSlotPast(date, time)) {
      setError('Ce créneau est déjà passé. Merci de retourner en arrière et de choisir un autre horaire.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('app_users')
        .select('name, phone, pending_referral_discount_pct, referral_discounts_available')
        .eq('id', authData.user?.id || '')
        .maybeSingle();

      const discountPct: number = (profile?.referral_discounts_available || 0) > 0
        ? 20
        : (profile?.pending_referral_discount_pct || 0);
      const ratio = discountPct > 0 ? (1 - discountPct / 100) : 1;
      const effectiveDeposit = Math.round(service.deposit * ratio * 100) / 100;

      const createRes = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizId: business.id,
          bizName: business.name,
          serviceId: service.id,
          serviceName: service.name,
          staffId: staff?.id,
          staffName: staff?.name,
          date,
          time,
          clientName: profile?.name || authData.user?.email || 'Client',
          clientPhone: profile?.phone || '',
          clientEmail: authData.user?.email || '',
        }),
      });
      const createData = await createRes.json();
      const { booking, member, error: createError } = createData;
      if (createError) throw new Error(createError);
      const isDemo = !!createData.demo;

      // Mode démo (fiche sans propriétaire réel, testeur whitelisté côté
      // serveur) : bookings/create n'a rien écrit en base — pas de booking.id
      // ni member.id réels. La confirmation est reconstruite depuis les
      // query params, pas depuis la base (voir confirmation/page.tsx).
      const successUrl = isDemo
        ? `${window.location.origin}/confirmation?demo=1&biz=${encodeURIComponent(business.name)}&service=${encodeURIComponent(service.name)}&date=${date}&time=${time}${staff?.name ? `&staff=${encodeURIComponent(staff.name)}` : ''}`
        : `${window.location.origin}/confirmation?booking=${booking.id}`;

      const checkoutRes = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveDeposit,
          quantity: 1,
          clientUserId: authData.user?.id || '',
          bookingMeta: {
            bookingId: isDemo ? '' : booking.id,
            memberId: isDemo ? '' : member.id,
            bizId: business.id,
            bizName: business.name,
            serviceName: service.name,
            date,
            time,
            clientName: profile?.name || '',
            clientPhone: profile?.phone || '',
            clientEmail: authData.user?.email || '',
            isDemo,
          },
          successUrl,
          cancelUrl: window.location.href,
        }),
      });
      const { url, error: checkoutError } = await checkoutRes.json();
      if (checkoutError) throw new Error(checkoutError);
      window.location.href = url;
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden mb-4">
        <div className="px-4 py-3.5 border-b border-white/[0.06] bg-gradient-to-r from-mint-500/5 to-transparent">
          <p className="text-xs font-bold text-mint-400/80 uppercase tracking-widest">Récapitulatif</p>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-white">{service.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">chez {business.name}</p>
            </div>
            <span className="text-sm font-bold text-slate-200">{service.price}€</span>
          </div>
          {staff && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Praticien</span>
              <span className="text-xs text-slate-300">{staff.emoji} {staff.name}</span>
            </div>
          )}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {date}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {time}
            </div>
          </div>
        </div>
        <div className="border-t border-dashed border-white/[0.08] mx-4" />
        <div className="px-4 py-4 space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Frais de réservation</span>
            <span className="text-xs font-medium text-slate-300">{service.deposit.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Frais de gestion</span>
            <span className="text-xs font-medium text-slate-300">{fraisGestion.toFixed(2)}€</span>
          </div>
        </div>
        <div className="mx-4 border-t border-white/[0.08]" />
        <div className="px-4 py-4 flex justify-between items-center">
          <span className="text-sm font-semibold text-white">Total à payer</span>
          <span className="text-lg font-bold text-mint-400">{total.toFixed(2)}€</span>
        </div>
        {solde > 0 && (
          <div className="mx-4 mb-4 rounded-xl bg-slate-800/50 border border-white/[0.06] px-3 py-2.5 flex items-start gap-2">
            <span className="text-slate-500 text-sm mt-0.5">ℹ️</span>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Solde de <strong className="text-slate-400">{solde.toFixed(2)}€</strong> à régler directement sur place.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50"
        style={{
          background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
          color: loading ? '#94a3b8' : '#0a1224',
        }}
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Redirection...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Payer {total.toFixed(2)}€
          </>
        )}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-600 flex items-center justify-center gap-1.5">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Paiement sécurisé via Stripe
      </p>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function StepPayment({
  business, service, staff, date, slots, participants, staffChoices,
}: {
  business: BusinessWithDetails;
  service: Service;
  staff: Staff | null;
  date: string;
  slots: string[];
  participants: number;
  staffChoices: (string | null)[];
}) {
  const [mode, setMode] = useState<PayMode>(null);

  // Solo booking (1 person)
  if (participants === 1) {
    return <SoloPayment business={business} service={service} staff={staff} date={date} time={slots[0]} />;
  }

  // Group: mode not yet chosen
  if (mode === null) {
    return (
      <div>
        <RecapBox business={business} service={service} staff={staff} date={date} slots={slots} participants={participants} staffChoices={staffChoices} />
        <ModeSelection service={service} participants={participants} onSelect={setMode} hideModeB={isNonRealBusiness(business)} />
      </div>
    );
  }

  // Group Mode A: pay for all
  if (mode === 'a') {
    return (
      <ModeAPayment
        business={business} service={service} staff={staff}
        date={date} slots={slots} participants={participants} staffChoices={staffChoices}
        onBack={() => setMode(null)}
      />
    );
  }

  // Group Mode B: share links
  return (
    <ModeBPayment
      business={business} service={service} staff={staff}
      date={date} slots={slots} participants={participants} staffChoices={staffChoices}
      onBack={() => setMode(null)}
    />
  );
}
