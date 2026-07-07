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
  onSelect: (date: string, slots: string[], participants: number, staffChoices: (string | null)[]) => void;
}) {
  // `max_persons` NULL = "Illimité" côté pro (PrestationsManager.tsx) : ne
  // doit pas être plafonné à une valeur arbitraire. Le vrai plafond du
  // système reste 23 (voir create-group/route.ts, "Groupe limité à 23
  // personnes maximum") — inutile d'en proposer plus dans le sélecteur,
  // ça échouerait de toute façon à la création du groupe.
  // `staff === null` obligatoire : un praticien précis déjà choisi à
  // l'étape service doit rester mono-personne, sinon la soumission finit
  // toujours en 409 (staffId unique envoyé à tout le groupe, cf. CONCEPTION_CAS2_STAFF_GROUPE.md étape 3).
  const maxPersons = service.allow_group === true
    ? (service.max_persons ?? 23)
    : (staff === null && business.staff.length >= 2 ? business.staff.length : 1);
  const isCollective = service.allow_group === true;

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [date, setDate] = useState<string | null>(null);
  const [participants, setParticipants] = useState(1);
  const [selectedSlots, setSelectedSlots] = useState<(string | null)[]>([null]);
  // Choix praticien par personne (CAS 2 uniquement) — même indexation que
  // `selectedSlots`, `null` = "peu importe". N'existe que pour les services
  // individuels multi-praticiens (participants > 1 ⟹ staff === null,
  // garanti par le gating de maxPersons ci-dessus).
  const [staffChoices, setStaffChoices] = useState<(string | null)[]>([null]);
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
      // "Peu importe" (cas 2, staffChoices absent) : le créneau doit pouvoir
      // couvrir tout le groupe, pas juste avoir 1 praticien libre — sinon un
      // slot affiché "Libre" pour participants=3 avec freeCount=1 échouerait
      // au paiement avec un 409 (voir CONCEPTION_CAS2_STAFF_GROUPE.md, étape 2).
      // Cas mono-personne inchangé : freeCount < 1 ⟺ freeCount === 0.
      return (staffAvailability[slot]?.freeCount ?? 0) < participants;
    }
    // Clé composite pour les services collectifs — doit correspondre à celle
    // construite côté serveur (availability/route.ts) : isole la séance par
    // praticien choisi (ou "" si aucun) pour ne pas se mélanger avec une
    // autre séance du même service donnée par un autre instructeur.
    const key = isCollective ? `${slot}::${staff?.id ?? ''}` : slot;
    return (occupancy[key] || 0) >= maxPersons;
  };

  const handleParticipantsChange = (n: number) => {
    setParticipants(n);
    // Flow collectif (staffAvailability absent) : comportement inchangé,
    // reset intégral — hors scope cas 2.
    if (!staffAvailability) {
      setSelectedSlots(Array(n).fill(null));
      setStaffChoices(Array(n).fill(null));
      return;
    }
    // Cas 2 : on conserve les créneaux déjà choisis, sauf ceux dont le
    // freeCount ne couvre plus le nouveau nombre de participants (l'utilisateur
    // voit alors ce créneau se dé-surligner, plutôt qu'un bouton "Continuer"
    // grisé sans explication — voir CONCEPTION_CAS2_STAFF_GROUPE.md, étape 2).
    // Lu depuis les valeurs de state courantes (fermeture du handler, pas de
    // course possible : géré par un seul clic synchrone).
    const nextSlots = Array.from({ length: n }, (_, i) => {
      const slot = selectedSlots[i] ?? null;
      if (slot && (staffAvailability[slot]?.freeCount ?? 0) < n) return null;
      return slot;
    });
    // Le choix praticien d'une personne ne survit que si son créneau survit
    // aussi — sinon il référencerait un slot qu'elle n'a plus.
    const nextChoices = Array.from({ length: n }, (_, i) => (nextSlots[i] ? (staffChoices[i] ?? null) : null));
    setSelectedSlots(nextSlots);
    setStaffChoices(nextChoices);
  };

  const handleSlotSelect = (personIdx: number, slot: string) => {
    setSelectedSlots((prev) => {
      const next = [...prev];
      next[personIdx] = slot;
      return next;
    });
    // Changement de créneau pour cette personne : son choix praticien précis
    // ne survit que s'il reste valide sur le NOUVEAU créneau (praticien
    // réellement libre à ce créneau, et pas déjà pris par un autre
    // participant déjà positionné dessus) — sinon retour à "peu importe".
    // "Peu importe" lui-même reste toujours valide, rien à faire.
    // Lu depuis `selectedSlots`/`staffAvailability` de la fermeture du
    // handler : les entrées des AUTRES personnes n'ont pas bougé (seul
    // personIdx change de créneau ici), donc leurs valeurs sont à jour.
    setStaffChoices((prev) => {
      const current = prev[personIdx];
      if (current === null) return prev;
      const freeAtNewSlot = staffAvailability?.[slot]?.freeStaffIds ?? [];
      const takenByOthersAtNewSlot = new Set(
        prev.filter((choice, i) => i !== personIdx && choice !== null && selectedSlots[i] === slot)
      );
      const stillValid = freeAtNewSlot.includes(current) && !takenByOthersAtNewSlot.has(current);
      if (stillValid) return prev;
      const next = [...prev];
      next[personIdx] = null;
      return next;
    });
  };

  const handleStaffChoiceSelect = (personIdx: number, staffId: string | null) => {
    setStaffChoices((prev) => {
      const next = [...prev];
      next[personIdx] = staffId;
      return next;
    });
  };

  // Praticiens libres à un créneau donné, moins ceux déjà choisis
  // précisément par une AUTRE personne sur ce MÊME créneau — l'anti-collision
  // est indispensable ici (pas du confort) : le back ne dé-doublonne jamais
  // les choix précis entre eux (candidateStaffIds = [staffChoice] sans
  // filtre côté assign_staff_and_create_booking), donc deux personnes qui
  // valideraient le même praticien précis au même créneau obtiendraient
  // systématiquement un 409 sur la 2e. Une personne à un autre créneau n'est
  // jamais concurrente : pas de conflit horaire réel possible.
  const getStaffOptionsFor = (personIdx: number): Staff[] => {
    const slot = selectedSlots[personIdx];
    if (!slot || !staffAvailability) return [];
    const free = staffAvailability[slot]?.freeStaffIds ?? [];
    const takenAtSameSlot = new Set(
      staffChoices
        .filter((choice, i) => i !== personIdx && choice !== null && selectedSlots[i] === slot)
    );
    return free
      .filter((id) => !takenAtSameSlot.has(id))
      .map((id) => business.staff.find((s) => s.id === id))
      .filter((s): s is Staff => !!s);
  };

  const chosenCount = selectedSlots.filter(Boolean).length;
  const allChosen = chosenCount === participants;
  // Cas 2 uniquement : les lignes de choix praticien s'affichent seulement
  // pour le groupe individuel multi-praticiens (jamais en flow collectif).
  const showStaffChoiceRows = !isCollective && participants > 1 && !!staffAvailability;

  // Pré-check souple par créneau : purement du confort, le vrai garde-fou
  // reste le 409 du back (voir CONCEPTION_CAS2_STAFF_GROUPE.md étape 3 — ne
  // couvre pas le cas résiduel d'exclusion globale du back entre créneaux
  // différents, accepté comme limite connue).
  const slotCapacityIssues: { slot: string; free: number; needed: number }[] = [];
  if (showStaffChoiceRows) {
    const bySlot = new Map<string, { precise: number; auto: number }>();
    selectedSlots.forEach((slot, i) => {
      if (!slot) return;
      const entry = bySlot.get(slot) ?? { precise: 0, auto: 0 };
      if (staffChoices[i] !== null) entry.precise += 1; else entry.auto += 1;
      bySlot.set(slot, entry);
    });
    for (const [slot, { precise, auto }] of bySlot) {
      const free = staffAvailability?.[slot]?.freeStaffIds.length ?? 0;
      if (auto > free - precise) slotCapacityIssues.push({ slot, free, needed: precise + auto });
    }
  }

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
                  setStaffChoices(Array(participants).fill(null));
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
      {date && slots.length === 0 && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-3 mb-4 flex items-start gap-2">
          <span className="text-red-400 mt-0.5 shrink-0">⚠️</span>
          <p className="text-xs text-red-300 leading-relaxed">
            Cet établissement n&apos;a pas encore configuré ses horaires d&apos;ouverture — aucun créneau
            ne peut être proposé pour le moment. Contactez l&apos;établissement directement, ou réessayez
            plus tard.
          </p>
        </div>
      )}

      {date && slots.length > 0 && (
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

              {showStaffChoiceRows && selectedSlots[personIdx] && (
                <div className="mt-3">
                  <p className="mb-2 text-[11px] text-slate-500 uppercase tracking-widest font-medium">
                    Praticien
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleStaffChoiceSelect(personIdx, null)}
                      className={`rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 border ${
                        staffChoices[personIdx] === null
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-navy-900 border-white/[0.08] text-slate-400 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      🎲 Peu importe
                    </button>
                    {getStaffOptionsFor(personIdx).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleStaffChoiceSelect(personIdx, s.id)}
                        className={`rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 border ${
                          staffChoices[personIdx] === s.id
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : 'bg-navy-900 border-white/[0.08] text-slate-400 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {s.emoji} {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {slotCapacityIssues.map(({ slot, free, needed }) => (
            <div key={slot} className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-lg shrink-0">⚠️</span>
              <p className="text-xs text-amber-300">
                Pas assez de praticiens disponibles à {slot} pour tout le monde ({free} libre{free > 1 ? 's' : ''} pour {needed} personne{needed > 1 ? 's' : ''}).
              </p>
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
        disabled={!date || !allChosen || (date !== null && participants === 0) || slotCapacityIssues.length > 0}
        onClick={() => {
          if (date && allChosen && slotCapacityIssues.length === 0) {
            onSelect(date, selectedSlots as string[], participants, staffChoices);
          }
        }}
        className="w-full rounded-2xl py-4 font-semibold text-sm transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
        style={date && allChosen && slotCapacityIssues.length === 0 ? {
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
