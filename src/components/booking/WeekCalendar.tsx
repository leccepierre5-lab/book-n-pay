'use client';
// src/components/booking/WeekCalendar.tsx
// Port de src/components/booking/WeekCalendar.jsx — vue semaine pour le
// client, à partir des bookings déjà chargés (pas de fetch supplémentaire).
import { useMemo, useState } from 'react';
import { addWeeks, subWeeks, startOfWeek, addDays, format, isSameDay, isBefore, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Booking, BookingMember } from '@/lib/database.types';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

type EnrichedBooking = Booking & { booking_members: BookingMember[]; _myMember?: BookingMember };

function getDotColor(bookingsOnDay: EnrichedBooking[]): 'green' | 'grey' | 'blue' | null {
  if (!bookingsOnDay.length) return null;
  const hasActive = bookingsOnDay.some((b) => {
    const m = b._myMember;
    return m?.status === 'paid' || m?.status === 'arrived' || (!m && b.status === 'active');
  });
  const hasCancelled = bookingsOnDay.every((b) => b._myMember?.status === 'cancelled');
  if (hasCancelled) return 'grey';
  if (hasActive) return 'green';
  return 'blue';
}

export default function WeekCalendar({
  bookings,
  onSelectBooking,
  myPhone,
}: {
  bookings: (Booking & { booking_members: BookingMember[] })[];
  onSelectBooking: (id: string) => void;
  myPhone: string | null;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const today = startOfDay(new Date());

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const bookingsByDate = useMemo(() => {
    const map: Record<string, EnrichedBooking[]> = {};
    bookings.forEach((b) => {
      const myMember = b.booking_members?.find((m) => m.phone === myPhone);
      const enriched: EnrichedBooking = { ...b, _myMember: myMember };
      if (!map[b.date]) map[b.date] = [];
      map[b.date].push(enriched);
    });
    return map;
  }, [bookings, myPhone]);

  const selectedDateStr = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null;
  const selectedBookings = selectedDateStr ? bookingsByDate[selectedDateStr] || [] : [];

  const weekLabel = `${format(weekStart, 'd MMM', { locale: fr })} – ${format(addDays(weekStart, 6), 'd MMM yyyy', { locale: fr })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            setWeekStart((w) => subWeeks(w, 1));
            setSelectedDay(null);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 text-white/70 hover:bg-white/10"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold text-white">{weekLabel}</span>
        <button
          onClick={() => {
            setWeekStart((w) => addWeeks(w, 1));
            setSelectedDay(null);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 text-white/70 hover:bg-white/10"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day, i) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayBookings = bookingsByDate[dateStr] || [];
          const dotColor = getDotColor(dayBookings);
          const isToday = isSameDay(day, new Date());
          const isPast = isBefore(day, today);
          const isSelected = selectedDay && isSameDay(day, selectedDay);
          const count = dayBookings.length;

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className={`relative flex flex-col items-center rounded-xl border-[1.5px] px-1 py-2.5 transition-all ${
                isSelected
                  ? 'border-emerald-600 bg-emerald-600'
                  : isToday
                  ? 'border-emerald-600/60 bg-emerald-600/10'
                  : 'border-white/10 bg-white/5'
              } ${isPast && !isSelected ? 'opacity-50' : ''}`}
            >
              <span className={`mb-1 text-[10px] font-medium ${isSelected ? 'text-white' : 'text-white/50'}`}>
                {DAY_LABELS[i]}
              </span>
              <span
                className={`text-[15px] font-bold ${
                  isSelected ? 'text-white' : isToday ? 'text-emerald-400' : 'text-white'
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="mt-1.5 flex h-2 items-center gap-0.5">
                {dotColor === 'green' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                {dotColor === 'grey' && <span className="h-1.5 w-1.5 rounded-full bg-white/30" />}
                {dotColor === 'blue' && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                {count > 1 && (
                  <span className={`ml-0.5 text-[8px] font-bold ${isSelected ? 'text-white/80' : 'text-white/40'}`}>
                    ×{count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-4 px-1">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-[10px] text-white/40">Confirmé</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-400" />
          <span className="text-[10px] text-white/40">Invité</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          <span className="text-[10px] text-white/40">Annulé</span>
        </div>
      </div>

      {selectedDay && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold text-white/50">
            {format(selectedDay, 'EEEE d MMMM', { locale: fr })}
          </p>
          {selectedBookings.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-5 text-center">
              <p className="text-sm text-white/30">Aucune réservation ce jour</p>
            </div>
          ) : (
            selectedBookings.map((b) => {
              const m = b._myMember;
              const statusColor =
                m?.status === 'paid' || m?.status === 'arrived'
                  ? 'text-emerald-400 bg-emerald-600/15 border-emerald-600/30'
                  : m?.status === 'cancelled'
                  ? 'text-white/40 bg-white/5 border-white/10'
                  : m?.status === 'invite'
                  ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                  : 'text-emerald-400 bg-emerald-600/15 border-emerald-600/30';
              const statusLabel =
                m?.status === 'paid'
                  ? 'Payé'
                  : m?.status === 'arrived'
                  ? 'Arrivé'
                  : m?.status === 'cancelled'
                  ? 'Annulé'
                  : m?.status === 'invite'
                  ? 'Invité'
                  : 'Confirmé';

              return (
                <button
                  key={b.id}
                  onClick={() => onSelectBooking(b.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/[0.08] p-3.5 text-left hover:bg-white/[0.12]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-white">{b.biz_name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-white/50">{b.service_name}</p>
                    <p className="mt-1 text-xs font-bold text-white/70">{b.time}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusColor}`}>
                    {statusLabel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
