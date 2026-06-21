'use client';
// src/components/booking/StepDateTime.tsx
// Port simplifié de src/components/booking/StepDateTime.jsx
import { useEffect, useMemo, useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service } from '@/lib/database.types';
import { isSlotClosed } from '@/lib/booking-utils';

// Créneaux génériques de 30 min entre l'ouverture et la fermeture.
// (Base44 stockait des `slots[]` en dur par business — à terme, on peut
// le réintroduire comme colonne business si tu veux des créneaux custom.)
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
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }
  return slots;
}

function nextDays(n: number): { iso: string; label: string }[] {
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    days.push({ iso, label });
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
      <p className="mb-2 text-sm text-white/60">Choisis une date</p>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const dayOfWeek = new Date(d.iso + 'T12:00:00').getDay();
          const closed = !business.open_days.includes(dayOfWeek);
          return (
            <button
              key={d.iso}
              disabled={closed}
              onClick={() => {
                setDate(d.iso);
                setTime(null);
              }}
              className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs ${
                closed
                  ? 'cursor-not-allowed bg-white/5 text-white/20'
                  : date === d.iso
                  ? 'bg-mint-500 text-navy-950'
                  : 'bg-navy-900 text-white/70'
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      {date && (
        <>
          <p className="mb-2 text-sm text-white/60">Choisis une heure</p>
          <div className="mb-5 grid grid-cols-4 gap-2">
            {slots.map((slot) => {
              const closed = isSlotClosed(business, date, slot);
              const maxPersons = service.max_persons || 1;
              const occupied = occupancy[slot] || 0;
              const full = occupied >= maxPersons;
              return (
                <button
                  key={slot}
                  disabled={closed || full}
                  onClick={() => setTime(slot)}
                  className={`rounded-lg py-2 text-xs ${
                    closed || full
                      ? 'cursor-not-allowed bg-white/5 text-white/20'
                      : time === slot
                      ? 'bg-mint-500 text-navy-950'
                      : 'bg-navy-900 text-white/70'
                  }`}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </>
      )}

      {service.max_persons && service.max_persons > 1 && (
        <div className="mb-5">
          <p className="mb-2 text-sm text-white/60">Nombre de participants</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setParticipants((p) => Math.max(1, p - 1))}
              className="h-8 w-8 rounded-full bg-navy-900 text-white"
            >
              −
            </button>
            <span className="text-white">{participants}</span>
            <button
              onClick={() => setParticipants((p) => Math.min(service.max_persons || 1, p + 1))}
              className="h-8 w-8 rounded-full bg-navy-900 text-white"
            >
              +
            </button>
          </div>
        </div>
      )}

      <button
        disabled={!date || !time}
        onClick={() => date && time && onSelect(date, time, participants)}
        className="w-full rounded-xl bg-mint-500 py-3 font-medium text-navy-950 disabled:opacity-30"
      >
        Continuer
      </button>
    </div>
  );
}
