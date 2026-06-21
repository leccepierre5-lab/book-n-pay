'use client';
// src/components/booking/MyBookingsList.tsx
// Port condensé de src/pages/MyBookings.jsx (783 lignes dans l'original).
// Couvre : liste, statuts, annulation (Joker ou marquage simple), carte
// fidélité, parrainage, vue calendrier semaine. Ne couvre PAS encore : sync
// calendrier externe, gestion de groupe inline, chat intégré (ChatThread séparé).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AppUser, Booking, BookingMember } from '@/lib/database.types';
import ParrainageCard from '@/components/loyalty/ParrainageCard';
import WeekCalendar from './WeekCalendar';

type BookingWithMembers = Booking & { booking_members: BookingMember[] };

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  paid: { label: '✓ Réservé', className: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40' },
  arrived: { label: '✓ Arrivé', className: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40' },
  no_show: { label: 'No-show', className: 'bg-red-600/20 text-red-400 border-red-600/40' },
  cancelled: { label: 'Annulé', className: 'bg-white/10 text-white/50 border-white/20' },
  invite: { label: '⚠️ Paiement en attente', className: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
};

const LOYALTY_BADGE: Record<string, string> = {
  Standard: '🆕',
  Bronze: '🥉',
  Argent: '🥈',
  Gold: '🏆',
};

export default function MyBookingsList({
  bookings,
  profile,
}: {
  bookings: BookingWithMembers[];
  profile: AppUser | null;
}) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [localBookings, setLocalBookings] = useState(bookings);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const myMember = (b: BookingWithMembers) =>
    b.booking_members.find((m) => m.phone === profile?.phone) || b.booking_members[0];

  const handleCancel = async (booking: BookingWithMembers) => {
    const member = myMember(booking);
    if (!member) return;
    setCancellingId(booking.id);
    setCancelError(null);

    try {
      if (profile?.phone && (profile.jokers_disponibles || 0) > 0 && member.deposit) {
        const res = await fetch('/api/loyalty/use-joker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: profile.phone,
            bookingId: booking.id,
            memberId: member.id,
            fraisReservation: member.deposit,
            paymentIntentId: member.stripe_payment_intent_id,
          }),
        });
        const data = await res.json();
        if (data.jokerApplique) {
          setLocalBookings((prev) =>
            prev.map((b) =>
              b.id === booking.id
                ? {
                    ...b,
                    booking_members: b.booking_members.map((m) =>
                      m.id === member.id ? { ...m, status: 'cancelled' } : m
                    ),
                  }
                : b
            )
          );
          setCancellingId(null);
          return;
        }
      }

      // Annulation standard avec remboursement conditionnel (>48h avant le
      // RDV) — applique la même règle CGV que les emails Stripe webhook.
      const cancelRes = await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, memberId: member.id }),
      });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok) {
        // ⚠️ CORRECTIF (trouvé en audit) : l'erreur était seulement
        // logguée en console, jamais montrée au client — il pouvait croire
        // que l'annulation avait échoué silencieusement sans comprendre
        // pourquoi, ou pire, retenter sans savoir que ça avait déjà échoué.
        console.error('[MyBookings] Annulation échouée:', cancelData.error);
        setCancelError(cancelData.error || "L'annulation a échoué. Réessaie.");
        setCancellingId(null);
        return;
      }
      setLocalBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id
            ? {
                ...b,
                booking_members: b.booking_members.map((m) =>
                  m.id === member.id ? { ...m, status: 'cancelled' } : m
                ),
              }
            : b
        )
      );
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold text-white">Mes réservations</h1>

        {cancelError && (
          <p className="mb-4 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">{cancelError}</p>
        )}

        {profile && (
          <div className="mb-5 flex items-center justify-between rounded-xl bg-navy-900 p-4">
            <div>
              <p className="text-sm text-white">
                {LOYALTY_BADGE[profile.statut] || '🆕'} Statut {profile.statut}
              </p>
              <p className="text-xs text-white/50">{profile.rdv_honores} RDV honorés</p>
            </div>
            <p className="text-sm text-mint-400">
              {profile.jokers_disponibles} Joker{profile.jokers_disponibles > 1 ? 's' : ''}
            </p>
          </div>
        )}

        {profile && (
          <div className="mb-5">
            <ParrainageCard profile={profile} />
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setView('list')}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              view === 'list' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Liste
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              view === 'calendar' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Calendrier
          </button>
        </div>

        {view === 'calendar' ? (
          <WeekCalendar
            bookings={localBookings}
            myPhone={profile?.phone || null}
            onSelectBooking={(id) => router.push(`/mes-reservations/${id}`)}
          />
        ) : (
        <div className="space-y-3">
          {localBookings.map((booking) => {
            const member = myMember(booking);
            const badge = member ? STATUS_BADGES[member.status] : null;
            return (
              <div key={booking.id} className="rounded-xl bg-navy-900 p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{booking.biz_name}</p>
                    <p className="text-xs text-white/50">{booking.service_name}</p>
                    <p className="text-xs text-white/50">
                      {booking.date} à {booking.time}
                    </p>
                  </div>
                  {badge && (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>

                {member?.status === 'paid' && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] text-white/40">
                      Remboursé si annulé plus de 48h avant le RDV.
                    </p>
                    <button
                      onClick={() => handleCancel(booking)}
                      disabled={cancellingId === booking.id}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {cancellingId === booking.id ? 'Annulation...' : 'Annuler cette réservation'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {localBookings.length === 0 && (
            <p className="py-10 text-center text-sm text-white/40">
              Tu n'as pas encore de réservation.{' '}
              <Link href="/recherche" className="text-mint-400">
                Trouver un établissement →
              </Link>
            </p>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
