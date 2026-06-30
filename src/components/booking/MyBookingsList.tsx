'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AppUser, Booking, BookingMember, EnrichedReferralEvent } from '@/lib/database.types';
import type { GroupMap } from '@/app/(public)/mes-reservations/page';
import { phonesMatch } from '@/lib/booking-utils';
import WeekCalendar from './WeekCalendar';
import GroupTimer from './GroupTimer';

type BookingWithMembers = Booking & { booking_members: BookingMember[] };

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  paid: { label: 'Réservé', dot: 'bg-emerald-400', badge: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25' },
  arrived: { label: 'Arrivé', dot: 'bg-emerald-400', badge: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25' },
  no_show: { label: 'No-show', dot: 'bg-red-400', badge: 'bg-red-500/12 text-red-400 border-red-500/25' },
  cancelled: { label: 'Annulé', dot: 'bg-slate-500', badge: 'bg-white/5 text-slate-500 border-white/10' },
  invite: { label: 'En attente', dot: 'bg-amber-400', badge: 'bg-amber-500/12 text-amber-300 border-amber-500/25' },
};

const MEMBER_ICONS: Record<string, string> = {
  paid: '✅',
  arrived: '✅',
  no_show: '❌',
  cancelled: '🚫',
  invite: '⏳',
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

// ── Group card ──────────────────────────────────────────────────────────────

function GroupCard({
  groupBookings,
  myPhone,
  onCancel,
  cancellingId,
}: {
  groupBookings: BookingWithMembers[];
  myPhone: string | null;
  onCancel: (booking: BookingWithMembers, member: BookingMember) => void;
  cancellingId: string | null;
}) {
  const [payingForId, setPayingForId] = useState<string | null>(null);

  const first = groupBookings[0];
  if (!first) return null;

  // Collect all members across all bookings in the group
  const allMembers = groupBookings.flatMap((b) =>
    b.booking_members.map((m) => ({ ...m, _bookingDate: b.date, _bookingTime: b.time, _bookingId: b.id }))
  );
  const activeMembers = allMembers.filter((m) => m.status !== 'cancelled');
  const paidCount = activeMembers.filter((m) => m.status === 'paid' || m.status === 'arrived').length;
  const totalCount = activeMembers.length;
  const allPaid = paidCount === totalCount && totalCount > 0;

  // Find user's booking and member in the group
  const myBooking = groupBookings.find((b) =>
    b.booking_members.some((m) => phonesMatch(m.phone, myPhone))
  );
  const myMemberEntry = myBooking?.booking_members.find((m) => phonesMatch(m.phone, myPhone));
  const isCancellable = myMemberEntry?.status === 'paid';
  const canPayForOthers = myMemberEntry?.status === 'paid';

  // Payment deadline — use the first booking's deadline (they all share the same)
  const deadline = first.payment_deadline;
  const deadlineInFuture = deadline && new Date(deadline) > new Date();

  const dateLabel = formatBookingDate(first.date);
  const timeRange = groupBookings.length > 1
    ? `${groupBookings[0].time} – ${groupBookings[groupBookings.length - 1].time}`
    : first.time;

  return (
    <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Groupe</span>
              <span className="text-[10px] text-slate-600">·</span>
              <span className="text-[10px] text-slate-500">{paidCount}/{totalCount} payés</span>
            </div>
            <p className="text-sm font-semibold text-white truncate">{first.biz_name}</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{first.service_name}</p>
          </div>
          <span className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
            allPaid
              ? 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25'
              : 'bg-amber-500/12 text-amber-300 border-amber-500/25'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${allPaid ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {allPaid ? 'Complet' : 'En cours'}
          </span>
        </div>

        {/* Date / time */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="text-slate-300 font-medium">{dateLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {timeRange}
          </div>
        </div>

        {/* Timer */}
        {!allPaid && deadlineInFuture && (
          <div className="mb-3">
            <GroupTimer deadline={deadline!} />
          </div>
        )}

        {/* Progress bar */}
        <div className="mb-3">
          <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: totalCount > 0 ? `${(paidCount / totalCount) * 100}%` : '0%',
                background: allPaid
                  ? 'linear-gradient(90deg, #34d399, #6ee7b7)'
                  : 'linear-gradient(90deg, #f59e0b, #fcd34d)',
              }}
            />
          </div>
        </div>

        {/* Participants list */}
        <div className="space-y-2">
          {activeMembers.map((m) => {
            const isMe = phonesMatch(m.phone, myPhone);
            const payerMember = m.paid_by_member_id
              ? allMembers.find((am) => am.id === m.paid_by_member_id)
              : null;
            const paidForAt = m.paid_for_at
              ? new Date(m.paid_for_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : null;

            return (
              <div key={m.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs flex-none">{MEMBER_ICONS[m.status] ?? '⏳'}</span>
                    <span className={`text-xs truncate ${isMe ? 'text-white font-medium' : 'text-slate-400'}`}>
                      {m.name || 'Invité'}
                      {isMe && <span className="text-slate-600 font-normal"> (moi)</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-none ml-2">
                    {/* Bouton "Payer pour lui" */}
                    {canPayForOthers && !isMe && m.status === 'invite' && deadlineInFuture && (
                      <button
                        disabled={payingForId === m.id}
                        onClick={async () => {
                          setPayingForId(m.id);
                          try {
                            const res = await fetch('/api/group/pay-for-member', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ targetMemberId: m.id }),
                            });
                            const data = await res.json();
                            if (res.ok && data.checkoutUrl) {
                              window.location.href = data.checkoutUrl;
                            } else {
                              alert(data.error || 'Erreur');
                              setPayingForId(null);
                            }
                          } catch {
                            alert('Erreur réseau');
                            setPayingForId(null);
                          }
                        }}
                        className="text-[10px] text-mint-400 hover:text-mint-300 disabled:opacity-50 font-medium transition-colors whitespace-nowrap"
                      >
                        {payingForId === m.id ? '...' : `Payer pour ${(m.name || 'lui').split(' ')[0]}`}
                      </button>
                    )}
                    <div className="flex items-center gap-1 text-slate-600 text-[10px]">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {(m as any)._bookingTime}
                    </div>
                  </div>
                </div>
                {/* Traçabilité paiement croisé */}
                {payerMember && paidForAt && (
                  <p className="text-[10px] text-slate-600 ml-5 mt-0.5">
                    Payé par {payerMember.name || 'un membre'} · {paidForAt}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isCancellable && myBooking && myMemberEntry && (
        <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center justify-between">
          <p className="text-[10px] text-slate-600">Remboursé si annulé 48h avant</p>
          <button
            onClick={() => onCancel(myBooking, myMemberEntry)}
            disabled={cancellingId === myBooking.id}
            className="text-xs text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors font-medium"
          >
            {cancellingId === myBooking.id ? 'Annulation...' : 'Annuler ma place'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Individual booking card ──────────────────────────────────────────────────

function BookingCard({
  booking,
  myPhone,
  onCancel,
  cancellingId,
}: {
  booking: BookingWithMembers;
  myPhone: string | null;
  onCancel: (booking: BookingWithMembers, member: BookingMember) => void;
  cancellingId: string | null;
}) {
  const member =
    booking.booking_members.find((m) => phonesMatch(m.phone, myPhone)) ||
    booking.booking_members[0];
  const statusConfig = member ? STATUS_CONFIG[member.status] : null;
  const isCancellable = member?.status === 'paid';
  const dateLabel = formatBookingDate(booking.date);

  return (
    <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden">
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
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
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

      {isCancellable && member && (
        <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center justify-between">
          <p className="text-[10px] text-slate-600">Remboursé si annulé 48h avant</p>
          <button
            onClick={() => onCancel(booking, member)}
            disabled={cancellingId === booking.id}
            className="text-xs text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors font-medium"
          >
            {cancellingId === booking.id ? 'Annulation...' : 'Annuler'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MyBookingsList({
  bookings,
  profile,
  referralEvents = [],
  groupMap = {},
}: {
  bookings: BookingWithMembers[];
  profile: AppUser | null;
  referralEvents?: EnrichedReferralEvent[];
  groupMap?: GroupMap;
}) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [localBookings, setLocalBookings] = useState(bookings);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [period, setPeriod] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const filteredBookings = localBookings.filter((b) =>
    period === 'upcoming' ? b.date >= today : b.date < today
  );

  const myPhone = profile?.phone ?? null;

  const handleCancel = async (booking: BookingWithMembers, member: BookingMember) => {
    setCancellingId(booking.id);
    setCancelError(null);

    try {
      if (myPhone && (profile?.jokers_disponibles || 0) > 0 && member.deposit) {
        const res = await fetch('/api/loyalty/use-joker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: myPhone,
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
                ? { ...b, booking_members: b.booking_members.map((m) => m.id === member.id ? { ...m, status: 'cancelled' as const } : m) }
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
            ? { ...b, booking_members: b.booking_members.map((m) => m.id === member.id ? { ...m, status: 'cancelled' as const } : m) }
            : b
        )
      );
    } finally {
      setCancellingId(null);
    }
  };

  const loyaltyInfo = profile ? LOYALTY_CONFIG[profile.statut] || LOYALTY_CONFIG.Standard : null;

  // Deduplicate: group bookings are rendered once via their group_ref, individual as-is
  const renderedGroupRefs = new Set<string>();
  type ListItem =
    | { type: 'group'; ref: string }
    | { type: 'individual'; booking: BookingWithMembers };

  const listItems: ListItem[] = [];

  for (const booking of filteredBookings) {
    if (booking.group_ref && groupMap[booking.group_ref]) {
      if (!renderedGroupRefs.has(booking.group_ref)) {
        renderedGroupRefs.add(booking.group_ref);
        listItems.push({ type: 'group', ref: booking.group_ref });
      }
    } else {
      listItems.push({ type: 'individual', booking });
    }
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-6">

        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </Link>
            <h1 className="text-lg font-bold text-white">Mes réservations</h1>
          </div>
          <Link href="/mes-favoris" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-mint-400 transition-colors">
            <span>❤️</span> Favoris
          </Link>
        </div>

        {cancelError && (
          <div className="mb-4 rounded-2xl bg-red-950/40 border border-red-500/20 px-4 py-3">
            <p className="text-sm text-red-400">{cancelError}</p>
          </div>
        )}

        <div className="mb-3 flex gap-1.5 p-1 bg-navy-900 rounded-xl border border-white/[0.06]">
          {(['upcoming', 'past'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all duration-200 ${
                period === p
                  ? 'bg-mint-500 text-navy-950 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {p === 'upcoming' ? 'À venir' : 'Passés'}
            </button>
          ))}
        </div>

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
            bookings={filteredBookings}
            myPhone={myPhone}
            onSelectBooking={(id) => router.push(`/mes-reservations/${id}`)}
          />
        ) : (
          <div className="space-y-3">
            {listItems.map((item) =>
              item.type === 'group' ? (
                <GroupCard
                  key={`group-${item.ref}`}
                  groupBookings={groupMap[item.ref]}
                  myPhone={myPhone}
                  onCancel={handleCancel}
                  cancellingId={cancellingId}
                />
              ) : (
                <BookingCard
                  key={item.booking.id}
                  booking={item.booking}
                  myPhone={myPhone}
                  onCancel={handleCancel}
                  cancellingId={cancellingId}
                />
              )
            )}

            {listItems.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-4xl mb-4">📅</p>
                <p className="text-slate-400 text-sm mb-4">
                  {period === 'upcoming'
                    ? 'Aucun rendez-vous à venir.'
                    : 'Aucun rendez-vous passé.'}
                </p>
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
