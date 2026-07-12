'use client';
// src/components/pro/AgendaView.tsx
// Planning par praticien — vue jour, colonnes = praticiens, lignes = heures.
// Lecture seule (v1) : consultation uniquement, aucune création/déplacement
// de RDV au clic. Alimenté par /api/pro/agenda?date=YYYY-MM-DD.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { addDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { parseParisDatetime, getParisDateOffsetStr } from '@/lib/booking-utils';

interface AgendaBooking {
  id: string;
  time: string;
  duration_minutes: number;
  service_name: string;
  client_name: string | null;
}

interface AgendaAbsence {
  start_at: string;
  end_at: string;
  reason: string | null;
}

interface WorkingRange {
  start_time: string;
  end_time: string;
}

interface AgendaColumn {
  staffId: string | null; // null = colonne "Non assigné"
  name: string;
  emoji: string | null;
  role: string | null;
  workingRanges: WorkingRange[];
  absences: AgendaAbsence[];
  bookings: AgendaBooking[];
}

interface AgendaData {
  date: string;
  businessHours: { open_time: string; close_time: string } | null;
  columns: AgendaColumn[];
}

const ROW_HEIGHT = 44; // px par tranche de 30 min
const COLUMN_WIDTH = 176; // px — largeur fixe par colonne praticien
const PALETTE = ['#22D3EE', '#A78BFA', '#FB923C', '#4ADE80', '#F472B6', '#60A5FA', '#FACC15', '#34D399'];
const UNASSIGNED_COLOR = '#F87171';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Couleur stable par praticien (pas de champ `color` en base) — dérivée d'un
// hash de son id plutôt que de l'emoji/role, qui ne sont pas des couleurs et
// peuvent être partagés entre plusieurs praticiens.
function colorForStaff(staffId: string | null): string {
  if (!staffId) return UNASSIGNED_COLOR;
  let hash = 0;
  for (let i = 0; i < staffId.length; i++) hash = (hash * 31 + staffId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

// Minutes écoulées depuis minuit Paris de `date`, pour un instant absolu ISO
// (absence, TIMESTAMPTZ) — même helper (parseParisDatetime) que le serveur,
// pour positionner correctement sur une grille en minutes locales.
function minutesSinceParisMidnight(iso: string, date: string): number {
  const dayStart = parseParisDatetime(date, '00:00').getTime();
  return (new Date(iso).getTime() - dayStart) / 60000;
}

export default function AgendaView() {
  const [date, setDate] = useState(() => getParisDateOffsetStr(0));
  const [data, setData] = useState<AgendaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback((d: string) => {
    setLoading(true);
    setError('');
    fetch(`/api/pro/agenda?date=${d}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error); setData(null); return; }
        setData(json);
      })
      .catch(() => setError('Erreur réseau'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const shiftDay = (delta: number) => {
    const next = addDays(parseParisDatetime(date, '12:00'), delta);
    setDate(format(next, 'yyyy-MM-dd'));
  };

  const dayBounds = useMemo(() => {
    if (!data?.businessHours) return null;
    return { start: toMinutes(data.businessHours.open_time), end: toMinutes(data.businessHours.close_time) };
  }, [data]);

  const hourMarks = useMemo(() => {
    if (!dayBounds) return [];
    const marks: number[] = [];
    for (let m = dayBounds.start; m <= dayBounds.end; m += 30) marks.push(m);
    return marks;
  }, [dayBounds]);

  const dateLabel = format(parseParisDatetime(date, '12:00'), 'EEEE d MMMM yyyy', { locale: fr });
  const isToday = date === getParisDateOffsetStr(0);
  const gridHeight = hourMarks.length * ROW_HEIGHT;

  return (
    <div className="space-y-3">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => shiftDay(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 text-white/70 hover:bg-white/10"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold capitalize text-white">{dateLabel}</p>
          {!isToday && (
            <button
              onClick={() => setDate(getParisDateOffsetStr(0))}
              className="text-[11px] text-mint-400 hover:text-mint-300"
            >
              Aujourd&apos;hui
            </button>
          )}
        </div>
        <button
          onClick={() => shiftDay(1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 text-white/70 hover:bg-white/10"
        >
          ›
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Chargement…</p>
      ) : !dayBounds ? (
        <div className="rounded-2xl border border-dashed border-white/[0.10] px-5 py-10 text-center text-sm text-slate-500">
          Horaires de l&apos;établissement non configurés.
        </div>
      ) : !data || data.columns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.10] px-5 py-10 text-center text-sm text-slate-500">
          Aucun praticien actif à afficher.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-navy-900/60">
          <div className="flex min-w-max">
            {/* Colonne heures, fixe à gauche */}
            <div className="sticky left-0 z-10 w-14 flex-shrink-0 border-r border-white/[0.08] bg-navy-900">
              <div className="h-12 border-b border-white/[0.08]" />
              {hourMarks.map((m) => (
                <div
                  key={m}
                  style={{ height: ROW_HEIGHT }}
                  className="border-b border-white/[0.04] px-1.5 text-right text-[10px] text-slate-500"
                >
                  {m % 60 === 0 ? `${String(Math.floor(m / 60)).padStart(2, '0')}:00` : ''}
                </div>
              ))}
            </div>

            {/* Colonnes praticiens */}
            {data.columns.map((col) => {
              const color = colorForStaff(col.staffId);
              return (
                <div
                  key={col.staffId ?? 'unassigned'}
                  style={{ width: COLUMN_WIDTH }}
                  className="flex-shrink-0 border-r border-white/[0.06] last:border-r-0"
                >
                  {/* En-tête colonne */}
                  <div
                    className="flex h-12 items-center gap-1.5 border-b border-white/[0.08] px-2"
                    style={{ borderTop: `2px solid ${color}` }}
                  >
                    {col.emoji && <span className="text-sm">{col.emoji}</span>}
                    <div className="min-w-0">
                      <p className={`truncate text-xs font-semibold ${col.staffId ? 'text-white' : 'text-red-300'}`}>
                        {col.name}
                      </p>
                      {col.role && <p className="truncate text-[10px] text-slate-500">{col.role}</p>}
                    </div>
                  </div>

                  {/* Grille du jour */}
                  <div className="relative" style={{ height: gridHeight }}>
                    {/* Fond hors-horaires par défaut (désactivé) */}
                    <div className="absolute inset-0 bg-black/20" />

                    {/* Repères horaires (lignes fines) */}
                    {hourMarks.map((m, i) => (
                      <div
                        key={m}
                        className="absolute left-0 right-0 border-b border-white/[0.03]"
                        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                      />
                    ))}

                    {/* Plages travaillées : fond neutre disponible */}
                    {col.workingRanges.map((r, i) => {
                      const top = ((toMinutes(r.start_time) - dayBounds.start) / 30) * ROW_HEIGHT;
                      const height = ((toMinutes(r.end_time) - toMinutes(r.start_time)) / 30) * ROW_HEIGHT;
                      if (height <= 0) return null;
                      return <div key={i} className="absolute left-0 right-0 bg-white/[0.09]" style={{ top, height }} />;
                    })}

                    {/* Absences : hachuré + motif */}
                    {col.absences.map((a, i) => {
                      const startMin = Math.max(dayBounds.start, minutesSinceParisMidnight(a.start_at, date));
                      const endMin = Math.min(dayBounds.end, minutesSinceParisMidnight(a.end_at, date));
                      if (endMin <= startMin) return null;
                      const top = ((startMin - dayBounds.start) / 30) * ROW_HEIGHT;
                      const height = ((endMin - startMin) / 30) * ROW_HEIGHT;
                      return (
                        <div
                          key={i}
                          className="absolute left-0.5 right-0.5 flex items-center justify-center overflow-hidden rounded-md border border-white/10 px-1"
                          style={{
                            top,
                            height,
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            backgroundImage:
                              'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0, rgba(255,255,255,0.07) 4px, transparent 4px, transparent 10px)',
                          }}
                          title={a.reason ?? 'Absence'}
                        >
                          <span className="truncate text-center text-[10px] text-slate-400">{a.reason || 'Absence'}</span>
                        </div>
                      );
                    })}

                    {/* RDV réservés */}
                    {col.bookings.map((b) => {
                      const start = toMinutes(b.time);
                      if (start + b.duration_minutes <= dayBounds.start || start >= dayBounds.end) return null;
                      const top = ((start - dayBounds.start) / 30) * ROW_HEIGHT;
                      const height = Math.max((b.duration_minutes / 30) * ROW_HEIGHT, 20);
                      return (
                        <div
                          key={b.id}
                          className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-navy-950"
                          style={{ top, height, backgroundColor: color }}
                          title={`${b.time} · ${b.client_name ?? 'Client'} · ${b.service_name}`}
                        >
                          <p className="truncate text-[10px] font-bold leading-tight">{b.time}</p>
                          <p className="truncate text-[10px] font-semibold leading-tight">{b.client_name || 'Client'}</p>
                          <p className="truncate text-[9px] leading-tight opacity-80">{b.service_name}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
