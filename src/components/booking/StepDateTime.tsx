'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';
import { isSlotClosed } from '@/lib/booking-utils';

type StaffAvailability = Record<string, { freeCount: number; freeStaffIds: string[] }>;

// ── Calendar helpers ──────────────────────────────────────────────────────────

function generateSlots(open: string | null, close: string | null): string[] {
  if (!open || !close) return [];
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const slots: string[] = [];
  let h = oh, m = om;
  while (h < ch || (h === ch && m < cm)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
}

function getMonthDays(year: number, month: number) {
  // month: 0-indexed
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Convert to Mon-first: Sun=6, Mon=0..Sat=5
  const startOffset = (firstDay + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isPast(iso: string): boolean {
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return iso < today;
}

function isToday(iso: string): boolean {
  return iso === new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

function isSlotPast(date: string, slot: string): boolean {
  const todayParis = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  if (date > todayParis) return false;
  if (date < todayParis) return true;
  const nowParis = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });
  return slot <= nowParis;
}

function formatDateLabel(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// ── Slot grid for one person ──────────────────────────────────────────────────

function SlotGrid({
  slots,
  date,
  isFull,
  selected,
  onSelect,
}: {
  slots: string[];
  date: string;
  isFull: (slot: string) => boolean;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((slot) => {
        const closed = isSlotClosed({ open_time: null, close_time: null, open_days: [] }, date, slot);
        const past = isSlotPast(date, slot);
        const full = isFull(slot);
        const unavailable = closed || past || full;
        const isSelected = selected === slot;

        return (
          <button
            key={slot}
            disabled={unavailable}
            onClick={() => onSelect(slot)}
            className={`rounded-xl py-3 flex flex-col items-center gap-0.5 transition-all duration-200 ${
              unavailable
                ? 'cursor-not-allowed bg-navy-900 border border-white/[0.05] opacity-50'
                : isSelected
                ? 'border border-emerald-500/40'
                : 'bg-navy-900 border border-white/[0.08] hover:border-white/20'
            }`}
            style={isSelected ? {
              background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
            } : undefined}
          >
            <span className={`text-sm font-bold ${isSelected ? 'text-navy-950' : unavailable ? 'text-slate-500' : 'text-white'}`}>
              {slot}
            </span>
            <span className={`text-[10px] font-medium ${
              isSelected ? 'text-navy-900' : past || full ? 'text-slate-600' : 'text-emerald-400'
            }`}>
              {past ? 'Passé' : full ? 'Complet' : 'Libre'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StepDateTime({
  business,
  service,
  staff,
  onSelect,
}: {
  business: BusinessWithDetails;
  service: Service;
  staff: Staff | null;
  onSelect: (date: string, slots: string[], participants: number) => void;
}) {
  const maxPersons = service.allow_group !== false ? (service.max_persons || 8) : 1;

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [date, setDate] = useState<string | null>(null);
  const [participants, setParticipants] = useState(1);
  const [selectedSlots, setSelectedSlots] = useState<(string | null)[]>([null]);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});
  const [staffAvailability, setStaffAvailability] = useState<StaffAvailability | null>(null);

  const slots = useMemo(
    () => generateSlots(business.open_time, business.close_time),
    [business.open_time, business.close_time]
  );

  const cells = useMemo(() => getMonthDays(calYear, calMonth), [calYear, calMonth]);

  useEffect(() => {
    if (!date) return;
    const params = new URLSearchParams({ bizId: business.id, date, serviceId: service.id });
    fetch(`/api/bookings/availability?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setOccupancy(data.counts || {});
        const sa = data.staffAvailability;
        // Défense côté client : {} est truthy et masquerait les counts ; on repasse à null si vide
        setStaffAvailability(sa && Object.keys(sa).length > 0 ? sa : null);
      });
  }, [date, business.id, service.id]);

  // Présent uniquement pour les services individuels d'un business qui a des
  // praticiens actifs (voir availability/route.ts) — sinon on retombe sur
  // l'occupation par tête (counts), comportement identique à avant.
  const isSlotFull = (slot: string): boolean => {
    if (staffAvailability) {
      if (staff) return !staffAvailability[slot]?.freeStaffIds.includes(staff.id);
      return (staffAvailability[slot]?.freeCount ?? 0) === 0;
    }
    return (occupancy[slot] || 0) >= maxPersons;
  };

  const handleParticipantsChange = (n: number) => {
    setParticipants(n);
    setSelectedSlots(Array(n).fill(null));
  };

  const handleSlotSelect = (personIdx: number, slot: string) => {
    setSelectedSlots((prev) => {
      const next = [...prev];
      next[personIdx] = slot;
      return next;
    });
  };

  const chosenCount = selectedSlots.filter(Boolean).length;
  const allChosen = chosenCount === participants;

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  };

  // Disable going to past months
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const canGoPrev = calYear > todayYear || (calYear === todayYear && calMonth > todayMonth);

  return (
    <div>
      {/* ── Calendar ── */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4 mb-5">
        <p className="mb-3 text-xs text-slate-500 uppercase tracking-widest font-medium">Choisir une date</p>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            disabled={!canGoPrev}
            className="w-9 h-9 rounded-full border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            ‹
          </button>
          <p className="text-sm font-semibold text-white">
            {MONTHS_FR[calMonth]} {calYear}
          </p>
          <button
            onClick={nextMonth}
            className="w-9 h-9 rounded-full border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            ›
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[10px] text-slate-600 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e-${idx}`} />;
            const iso = toIso(calYear, calMonth, day);
            const dayOfWeek = new Date(iso + 'T12:00:00').getDay();
            const closed = !business.open_days.includes(dayOfWeek);
            const past = isPast(iso);
            const today = isToday(iso);
            const disabled = closed || past;
            const selected = date === iso;

            return (
              <button
                key={iso}
                disabled={disabled}
                onClick={() => {
                  setDate(iso);
                  setSelectedSlots(Array(participants).fill(null));
                  setOccupancy({});
                  setStaffAvailability(null);
                }}
                className={`aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all duration-150 ${
                  disabled
                    ? 'opacity-20 cursor-not-allowed text-slate-500'
                    : selected
                    ? 'text-navy-950 font-bold'
                    : today
                    ? 'border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                style={selected ? {
                  background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
                  boxShadow: '0 2px 10px rgba(52,211,153,0.35)',
                } : undefined}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* Selected date label */}
        {date && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs">📅</span>
            <p className="text-xs text-emerald-400 font-medium capitalize">{formatDateLabel(date)}</p>
          </div>
        )}
      </div>

      {/* ── Participants selector ── */}
      {date && maxPersons > 1 && (
        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4 mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
              <p className="text-sm text-white font-medium">Nombre de personnes</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleParticipantsChange(Math.max(1, participants - 1))}
                className="w-9 h-9 rounded-xl bg-navy-800 border border-white/[0.08] text-white font-bold text-lg flex items-center justify-center hover:bg-navy-700 transition-all"
              >
                −
              </button>
              <span className="text-white font-bold text-base w-5 text-center">{participants}</span>
              <button
                onClick={() => handleParticipantsChange(Math.min(maxPersons, participants + 1))}
                className="w-9 h-9 rounded-xl bg-navy-800 border border-white/[0.08] text-white font-bold text-lg flex items-center justify-center hover:bg-navy-700 transition-all"
              >
                +
              </button>
              {participants > 1 && (
                <span className="text-xs text-emerald-400 ml-1">Créneau individuel par personne</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Slot picker(s) ── */}
      {date && (
        <>
          {participants > 1 && (
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 px-4 py-3 mb-4 flex items-start gap-2">
              <span className="text-blue-400 mt-0.5 shrink-0">ⓘ</span>
              <p className="text-xs text-blue-300 leading-relaxed">
                Chaque personne choisit son propre créneau. Chacun reçoit un QR code individuel.
              </p>
            </div>
          )}

          {Array.from({ length: participants }).map((_, personIdx) => (
            <div key={personIdx} className="mb-5">
              {participants > 1 && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-navy-950 text-xs font-bold shrink-0">
                    {personIdx + 1}
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {personIdx === 0 ? 'Vous' : `Personne ${personIdx + 1}`}
                  </p>
                </div>
              )}

              {participants === 1 && (
                <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-widest">
                  Choisir un créneau
                </p>
              )}

              <SlotGrid
                slots={slots}
                date={date}
                isFull={isSlotFull}
                selected={selectedSlots[personIdx]}
                onSelect={(s) => handleSlotSelect(personIdx, s)}
              />
            </div>
          ))}

          {/* Validation message */}
          {participants > 1 && !allChosen && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-lg shrink-0">👆</span>
              <p className="text-xs text-amber-300">
                Sélectionnez un créneau pour chaque personne ({chosenCount}/{participants} faits).
              </p>
            </div>
          )}
        </>
      )}

      <button
        disabled={!date || !allChosen || (date !== null && participants === 0)}
        onClick={() => {
          if (date && allChosen) {
            onSelect(date, selectedSlots as string[], participants);
          }
        }}
        className="w-full rounded-2xl py-4 font-semibold text-sm transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
        style={date && allChosen ? {
          background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: '0 4px 24px rgba(52,211,153,0.4)',
          color: '#0a1224',
        } : { background: '#334155', color: '#94a3b8' }}
      >
        {!date ? 'Choisissez une date' : !allChosen ? `Choisissez un créneau` : 'Continuer'}
      </button>
    </div>
  );
}
