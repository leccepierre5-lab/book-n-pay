'use client';
// src/components/pro/ProCalendar.tsx
// Port de src/components/pro/ProCalendar.jsx — vue mois avec heatmap de
// fréquentation, détail jour, export .ics. Charge les bookings du mois
// affiché via /api/pro/bookings-month à chaque navigation.
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import CaisseEncaissement from './CaisseEncaissement';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const STATUS_CONFIG: Record<string, { label: string; color: string; text: string }> = {
  paid: { label: 'Confirmé', color: '#D1FAE5', text: '#059669' },
  arrived: { label: 'Arrivé', color: '#ECFDF5', text: '#059669' },
  no_show: { label: 'Absent', color: '#FFF1F2', text: '#E11D48' },
  invite: { label: 'En attente', color: '#FFFBEB', text: '#D97706' },
  cancelled: { label: 'Annulé', color: '#F4F4F8', text: '#7A7A8C' },
};

interface BookingMemberRow {
  id: string;
  name: string;
  status: string;
  deposit: number | null;
  payment_mode: string | null;
  referrer_name?: string | null;
  referral_discount_pct?: number;
}

interface BookingRow {
  id: string;
  date: string;
  time: string;
  service_name: string;
  staff_name: string | null;
  booking_members: BookingMemberRow[];
  services?: { price: number } | null;
}

function exportDayToICS(date: string, dayBookings: BookingRow[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BooknPay//Pro//FR'];
  dayBookings.forEach((b) => {
    const dtStart = `${b.date.replace(/-/g, '')}T${b.time.replace(':', '')}00`;
    const members = b.booking_members
      .filter((m) => m.status !== 'cancelled')
      .map((m) => m.name)
      .join(', ');
    lines.push(
      'BEGIN:VEVENT',
      `DTSTART:${dtStart}`,
      `SUMMARY:${b.service_name}${b.staff_name ? ` (${b.staff_name})` : ''}`,
      `DESCRIPTION:Clients: ${members}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rdv-${date}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProCalendar({ bizId }: { bizId: string }) {
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCaisse, setSelectedCaisse] = useState<{ booking: BookingRow; member: BookingMemberRow } | null>(null);

  const loadMonth = useCallback(
    (date: Date) => {
      setLoading(true);
      fetch(`/api/pro/bookings-month?bizId=${bizId}&year=${date.getFullYear()}&month=${date.getMonth()}`)
        .then((r) => r.json())
        .then((data) => setBookings(data.bookings || []))
        .finally(() => setLoading(false));
    },
    [bizId]
  );

  useEffect(() => {
    loadMonth(viewDate);
  }, [viewDate, loadMonth]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    bookings.forEach((b) => {
      if (!b.date) return;
      const count = b.booking_members?.filter((m) => m.status !== 'cancelled').length || 0;
      map[b.date] = (map[b.date] || 0) + count;
    });
    return map;
  }, [bookings]);

  const maxCount = Math.max(...Object.values(countByDay), 1);

  const getHeatColor = (count: number) => {
    if (!count) return null;
    const ratio = count / maxCount;
    if (ratio >= 0.8) return '#065F46';
    if (ratio >= 0.5) return '#059669';
    if (ratio >= 0.25) return '#6EE7B7';
    return '#D1FAE5';
  };

  const getTextColor = (count: number) => {
    if (!count) return 'text-white';
    const ratio = count / maxCount;
    return ratio >= 0.25 ? 'text-white' : 'text-emerald-900';
  };

  const selectedDateStr = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null;
  const selectedDayBookings = useMemo(
    () =>
      selectedDay
        ? bookings.filter((b) => b.date === selectedDateStr).sort((a, b) => a.time.localeCompare(b.time))
        : [],
    [selectedDay, selectedDateStr, bookings]
  );

  const dayStats = useMemo(() => {
    if (!selectedDayBookings.length) return null;
    const allMembers = selectedDayBookings.flatMap(
      (b) => b.booking_members?.filter((m) => m.status !== 'cancelled') || []
    );
    const arrived = allMembers.filter((m) => m.status === 'arrived').length;
    const paid = allMembers.filter((m) => m.status === 'paid').length;
    const deposits = allMembers.reduce((s, m) => s + (m.deposit || 0), 0);
    return { total: allMembers.length, arrived, paid, deposits };
  }, [selectedDayBookings]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-navy-900">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <button
            onClick={() => setViewDate((d) => subMonths(d, 1))}
            className="rounded-lg p-1.5 hover:bg-white/10"
          >
            ‹
          </button>
          <h3 className="text-sm font-semibold capitalize text-white">
            {format(viewDate, 'MMMM yyyy', { locale: fr })}
          </h3>
          <button
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            className="rounded-lg p-1.5 hover:bg-white/10"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-white/10">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-2 text-center text-[10px] font-semibold text-white/40">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const count = countByDay[dateStr] || 0;
            const heatColor = getHeatColor(count);
            const textColor = getTextColor(count);
            const inMonth = isSameMonth(day, viewDate);
            const isToday = isSameDay(day, new Date());
            const isSelected = selectedDay && isSameDay(day, selectedDay);

            return (
              <button
                key={dateStr}
                onClick={() => inMonth && setSelectedDay(isSelected ? null : day)}
                className={`relative flex aspect-square flex-col items-center justify-center border-[0.5px] border-white/5 text-xs transition-opacity ${
                  !inMonth ? 'cursor-default opacity-30' : 'cursor-pointer hover:opacity-80'
                } ${isSelected ? 'ring-2 ring-inset ring-mint-500' : ''}`}
                style={{ background: heatColor || 'transparent' }}
              >
                <span className={`font-semibold ${textColor}`}>{format(day, 'd')}</span>
                {count > 0 && inMonth && (
                  <span className={`text-[9px] font-bold ${textColor}`}>{count}</span>
                )}
                {isToday && (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-mint-500" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-2">
          <span className="text-[10px] text-white/40">Clients/jour :</span>
          {['#D1FAE5', '#6EE7B7', '#059669', '#065F46'].map((c, i) => (
            <div key={c} className="flex items-center gap-1">
              <div className="h-3 w-3 rounded-sm" style={{ background: c }} />
              <span className="text-[9px] text-white/40">{['1', '2-3', '4-6', '7+'][i]}</span>
            </div>
          ))}
        </div>
      </div>

      {loading && <p className="text-center text-xs text-white/30">Chargement du mois...</p>}

      {selectedDay && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-navy-900">
          <div className="flex items-center justify-between border-b border-white/10 bg-navy-800 px-4 py-3">
            <div>
              <p className="text-sm font-semibold capitalize text-white">
                {format(selectedDay, 'EEEE d MMMM yyyy', { locale: fr })}
              </p>
              {dayStats && (
                <p className="mt-0.5 text-[11px] text-white/50">
                  {selectedDayBookings.length} RDV · {dayStats.total} client{dayStats.total > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedDayBookings.length > 0 && (
                <button
                  onClick={() => exportDayToICS(selectedDateStr!, selectedDayBookings)}
                  className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/10"
                >
                  ⬇ .ics
                </button>
              )}
              <button onClick={() => setSelectedDay(null)} className="rounded-lg p-1.5 hover:bg-white/10">
                ✕
              </button>
            </div>
          </div>

          {dayStats && (
            <div className="grid grid-cols-4 divide-x divide-white/10 border-b border-white/10">
              {[
                { label: 'Total', value: dayStats.total, color: '#f8fafc' },
                { label: 'Arrivés', value: dayStats.arrived, color: '#059669' },
                { label: 'Confirmés', value: dayStats.paid, color: '#3B82F6' },
                { label: 'Frais résa', value: `${dayStats.deposits}€`, color: '#7C3AED' },
              ].map((k) => (
                <div key={k.label} className="py-2.5 text-center">
                  <p className="text-[15px] font-bold" style={{ color: k.color }}>
                    {k.value}
                  </p>
                  <p className="text-[9px] font-medium text-white/40">{k.label}</p>
                </div>
              ))}
            </div>
          )}

          {selectedDayBookings.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">Aucun RDV ce jour</div>
          ) : (
            <div className="max-h-72 divide-y divide-white/10 overflow-y-auto">
              {selectedDayBookings.map((b) => {
                const activeMembers = b.booking_members?.filter((m) => m.status !== 'cancelled') || [];
                return (
                  <div key={b.id} className="px-4 py-3">
                    <div className="mb-2 flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 font-mono text-sm font-bold text-white">
                        {b.time}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{b.service_name}</p>
                        {b.staff_name && <p className="text-[11px] text-white/50">avec {b.staff_name}</p>}
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-white/70">
                        {activeMembers.length}
                      </span>
                    </div>
                    <div className="space-y-1.5 pl-[60px]">
                      {activeMembers.map((m) => {
                        const cfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.paid;
                        return (
                          <div key={m.id} className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-white">{m.name || 'Participant'}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              {m.deposit && m.deposit > 0 && (
                                <span className="text-[10px] font-semibold text-purple-400">
                                  {m.deposit}€
                                </span>
                              )}
                              {m.status === 'paid' ? (
                                <button
                                  onClick={() => setSelectedCaisse({ booking: b, member: m })}
                                  className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-navy-950"
                                  style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)' }}
                                >
                                  Clôturer
                                </button>
                              ) : (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                  style={{ background: cfg.color, color: cfg.text }}
                                >
                                  {cfg.label}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedCaisse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm">
            <CaisseEncaissement
              member={selectedCaisse.member}
              booking={selectedCaisse.booking}
              onValidatePresence={() => {
                setBookings((prev) =>
                  prev.map((b) =>
                    b.id === selectedCaisse.booking.id
                      ? { ...b, booking_members: b.booking_members.map((m) => m.id === selectedCaisse.member.id ? { ...m, status: 'arrived' } : m) }
                      : b
                  )
                );
              }}
            />
            <button onClick={() => setSelectedCaisse(null)} className="mt-2 w-full rounded-xl bg-navy-900 border border-white/[0.08] py-2.5 text-xs text-slate-400 hover:text-white transition-colors">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
