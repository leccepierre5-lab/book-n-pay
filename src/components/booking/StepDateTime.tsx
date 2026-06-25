'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service } from '@/lib/database.types';
import { isSlotClosed } from '@/lib/booking-utils';

function generateSlots(open: string | null, close: string | null): string[] {
  if (!open || !close) return [];
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const slots: string[] = [];
  let h = oh;
  let m = om;
  while (h < ch || (h === ch && m < cm)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
}

function nextDays(n: number): { iso: string; dayNum: string; dayName: string; monthShort: string }[] {
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const dayNum = d.toLocaleDateString('fr-FR', { day: 'numeric' });
    const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
    const monthShort = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
    days.push({ iso, dayNum, dayName, monthShort });
  }
  return days;
}

export default function StepDateTime({
  business,
  service,
  onSelect,
}: {
  business: BusinessWithDetails;
  service: Service;
  onSelect: (date: string, time: string, participants: number) => void;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [participants, setParticipants] = useState(1);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});

  const days = useMemo(() => nextDays(14), []);
  const slots = useMemo(
    () => generateSlots(business.open_time, business.close_time),
    [business.open_time, business.close_time]
  );

  useEffect(() => {
    if (!date) return;
    fetch(`/api/bookings/availability?bizId=${business.id}&date=${date}`)
      .then((r) => r.json())
      .then((data) => setOccupancy(data.counts || {}));
  }, [date, business.id]);

  return (
    <div>
      {/* Date selector */}
      <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-widest">Date</p>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const dayOfWeek = new Date(d.iso + 'T12:00:00').getDay();
          const closed = !business.open_days.includes(dayOfWeek);
          const isSelected = date === d.iso;
          return (
            <button
              key={d.iso}
              disabled={closed}
              onClick={() => {
                setDate(d.iso);
                setTime(null);
              }}
              className={`flex-shrink-0 flex flex-col items-center rounded-2xl px-3.5 py-2.5 text-center transition-all duration-200 min-w-[56px] ${
                closed
                  ? 'cursor-not-allowed opacity-25 bg-navy-900 border border-white/5'
                  : isSelected
                  ? 'border border-mint-500/40 text-navy-950'
                  : 'bg-navy-900 border border-white/[0.08] text-slate-400 hover:border-white/15 hover:text-white'
              }`}
              style={isSelected ? {
                background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
                boxShadow: '0 2px 12px rgba(52,211,153,0.35)',
              } : undefined}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide">{d.dayName}</span>
              <span className={`text-base font-bold leading-tight ${isSelected ? 'text-navy-950' : ''}`}>{d.dayNum}</span>
              <span className="text-[10px] opacity-70">{d.monthShort}</span>
            </button>
          );
        })}
      </div>

      {/* Time slots */}
      {date && (
        <>
          <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-widest">Heure</p>
          <div className="mb-6 grid grid-cols-4 gap-2">
            {slots.map((slot) => {
              const closed = isSlotClosed(business, date, slot);
              const maxPersons = service.max_persons || 1;
              const occupied = occupancy[slot] || 0;
              const full = occupied >= maxPersons;
              const isSelected = time === slot;
              return (
                <button
                  key={slot}
                  disabled={closed || full}
                  onClick={() => setTime(slot)}
                  className={`rounded-xl py-2.5 text-xs font-medium transition-all duration-200 ${
                    closed || full
                      ? 'cursor-not-allowed opacity-20 bg-navy-900 border border-white/5'
                      : isSelected
                      ? 'border border-mint-500/40 text-navy-950 shadow-[0_2px_10px_rgba(52,211,153,0.3)]'
                      : 'bg-navy-900 border border-white/[0.08] text-slate-400 hover:border-white/15 hover:text-white'
                  }`}
                  style={isSelected ? {
                    background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
                  } : undefined}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Participants */}
      {service.max_persons && service.max_persons > 1 && (
        <div className="mb-6 rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
          <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-widest">Participants</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Nombre de personnes</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setParticipants((p) => Math.max(1, p - 1))}
                className="w-9 h-9 rounded-xl bg-navy-800 border border-white/[0.08] text-white font-bold text-lg flex items-center justify-center hover:bg-navy-700 hover:border-white/15 transition-all"
              >
                −
              </button>
              <span className="text-white font-semibold text-base w-4 text-center">{participants}</span>
              <button
                onClick={() => setParticipants((p) => Math.min(service.max_persons || 1, p + 1))}
                className="w-9 h-9 rounded-xl bg-navy-800 border border-white/[0.08] text-white font-bold text-lg flex items-center justify-center hover:bg-navy-700 hover:border-white/15 transition-all"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        disabled={!date || !time}
        onClick={() => date && time && onSelect(date, time, participants)}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100 hover:scale-[1.01] active:scale-[0.99]"
        style={date && time ? {
          background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: '0 4px 24px rgba(52,211,153,0.4)',
        } : { background: '#334155' }}
      >
        Continuer
      </button>
    </div>
  );
}
