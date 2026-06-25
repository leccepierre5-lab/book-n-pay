'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AppUser, Booking, BookingMember, ReferralEvent } from '@/lib/database.types';
import ParrainageCard from '@/components/loyalty/ParrainageCard';
import WeekCalendar from './WeekCalendar';

type BookingWithMembers = Booking & { booking_members: BookingMember[] };

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  paid: { label: 'Réservé', dot: 'bg-emerald-400', badge: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25' },
  arrived: { label: 'Arrivé', dot: 'bg-emerald-400', badge: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25' },
  no_show: { label: 'No-show', dot: 'bg-red-400', badge: 'bg-red-500/12 text-red-400 border-red-500/25' },
  cancelled: { label: 'Annulé', dot: 'bg-slate-500', badge: 'bg-white/5 text-slate-500 border-white/10' },
  invite: { label: 'Paiement en attente', dot: 'bg-amber-400', badge: 'bg-amber-500/12 text-amber-300 border-amber-500/25' },
};

const LOYALTY_CONFIG: Record<string, { emoji: string; color: string }> = {
  Standard: { emoji: '🆕', color: 'text-slate-400' },
  Bronze: { emoji: '🥉', color: 'text-amber-600' },
  Argent: { emoji: '🥈', color: 'text-slate-300' },
  Gold: { emoji: '🏆', color: 'text-amber-400' },
};

function formatBookingDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  if (days === -1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function MyBookingsList({
  bookings,
  profile,
  referralEvents = [],
}: {
  bookings: BookingWithMembers[];
  profile: AppUser | null;
  referralEvents?: ReferralEvent[];
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
                ? { ...b, booking_members: b.booking_members.map((m) => m.id === member.id ? { ...m, status: 'cancelled' } : m) }
                : b
            )
          );
          setCancellingId(null);
          return;
        }
      }

      const cancelRes = await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, memberId: member.id }),
      });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok) {
        setCancelError(cancelData.error || "L'annulation a échoué. Réessaie.");
        setCancellingId(null);
        return;
      }
      setLocalBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id
            ? { ...b, booking_members: b.booking_members.map((m) => m.id === member.id ? { ...m, status: 'cancelled' } : m) }
            : b
        )
      );
    } finally {
      setCancellingId(null);
    }
  };

  const loyaltyInfo = profile ? LOYALTY_CONFIG[profile.statut] || LOYALTY_CONFIG.Standard : null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-6">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Mes réservations</h1>
          <Link href="/mes-favoris" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-mint-400 transition-colors">
            <span>❤️</span> Favoris
          </Link>
        </div>

        {cancelError && (
          <div className="mb-4 rounded-2xl bg-red-950/40 border border-red-500/20 px-4 py-3">
            <p className="text-sm text-red-400">{cancelError}</p>
          </div>
        )}

        {/* Loyalty card */}
        {profile && loyaltyInfo && (
          <div className="mb-4 rounded-2xl bg-navy-900 border border-white/[0.08] p-4 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-mint-500/5 to-transparent pointer-events-none" />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-1">Statut fidélité</p>
                <p className={`text-sm font-bold ${loyaltyInfo.color}`}>
                  {loyaltyInfo.emoji} Statut {profile.statut}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{profile.rdv_honores} RDV honorés</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-mint-400">{profile.jokers_disponibles}</p>
                <p className="text-xs text-slate-500">Joker{profile.jokers_disponibles > 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>
        )}

        {/* Parrainage */}
        {profile && (
          <div className="mb-5">
            <ParrainageCard profile={profile} referralEvents={referralEvents} />
          </div>
        )}

        {/* View toggle */}
        <div className="mb-4 flex gap-1.5 p-1 bg-navy-900 rounded-xl border border-white/[0.06]">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all duration-200 ${
                view === v
                  ? 'bg-mint-500 text-navy-950 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {v === 'list' ? 'Liste' : 'Calendrier'}
            </button>
          ))}
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
              const statusConfig = member ? STATUS_CONFIG[member.status] : null;
              const isCancellable = member?.status === 'paid';
              const dateLabel = formatBookingDate(booking.date);

              return (
                <div key={booking.id} className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{booking.biz_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{booking.service_name}</p>
                      </div>
                      {statusConfig && (
                        <span className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusConfig.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                          {statusConfig.label}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <span className={member?.status === 'paid' ? 'text-slate-300 font-medium' : ''}>{dateLabel}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        {booking.time}
                      </div>
                    </div>
                  </div>

                  {isCancellable && (
                    <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center justify-between">
                      <p className="text-[10px] text-slate-600">Remboursé si annulé 48h avant</p>
                      <button
                        onClick={() => handleCancel(booking)}
                        disabled={cancellingId === booking.id}
                        className="text-xs text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors font-medium"
                      >
                        {cancellingId === booking.id ? 'Annulation...' : 'Annuler'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {localBookings.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-4xl mb-4">📅</p>
                <p className="text-slate-400 text-sm mb-4">Aucune réservation pour l'instant.</p>
                <Link
                  href="/recherche"
                  className="inline-flex items-center gap-2 rounded-2xl py-3 px-6 text-sm font-semibold text-navy-950 transition-all"
                  style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 20px rgba(52,211,153,0.35)' }}
                >
                  Trouver un établissement →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
