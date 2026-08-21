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
import FicheClientIntelligente from './FicheClientIntelligente';
import { formatTime, parseParisDatetime, calcFraisGestion } from '@/lib/booking-utils';
import Modal from '@/components/ui/Modal';

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
  phone: string | null;
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
  staff_id: string | null;
  group_ref: string | null;
  booking_members: BookingMemberRow[];
  services?: { price: number } | null;
}

// Doit rester synchro avec RESCHEDULE_MIN_MARGIN_HOURS (src/lib/reschedule.ts)
// — dupliqué ici plutôt qu'importé pour ne pas tirer `crypto`/le module
// serveur dans le bundle client. Le serveur reste seul juge (route
// pro/reschedule-propose) : cette valeur ne sert qu'à l'affichage.
const RESCHEDULE_MIN_MARGIN_HOURS = 2;

function exportDayToICS(date: string, dayBookings: BookingRow[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BooknPay//Pro//FR'];
  dayBookings.forEach((b) => {
    // formatTime() normalise d'abord en "HH:MM" (un seul ':') — b.time peut
    // arriver en "HH:MM:SS" (colonne Postgres `time` via PostgREST) ou déjà
    // en "HH:MM" selon l'appelant ; sans cette normalisation, .replace(':','')
    // sur "HH:MM:SS" ne retire que le premier ':' et le "00" ajouté ensuite
    // produit un DTSTART invalide (ex: "1430:0000" au lieu de "143000").
    const dtStart = `${b.date.replace(/-/g, '')}T${formatTime(b.time).replace(':', '')}00`;
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
  // C15 — annulation d'un RDV à venir par le pro (pro/cancel-booking/route.ts).
  const [cancelTarget, setCancelTarget] = useState<{ booking: BookingRow; member: BookingMemberRow } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Geste commercial no-show (FicheClientIntelligente) — trouvé le
  // 20/08/2026 (parcours navigateur réel) : ce bouton n'existait jusqu'ici
  // que dans l'onglet "Aujourd'hui" du dashboard (ProDashboard.tsx). Le cron
  // de détection automatique (check-no-shows, quotidien 8h) ne peut
  // structurellement jamais flaguer un no-show le jour même — donc tout
  // no-show détecté automatiquement n'était plus jamais atteignable nulle
  // part dans l'UI. Le calendrier mensuel, lui, permet déjà de naviguer
  // n'importe quel jour passé : c'est ici que le geste doit être accessible,
  // pas seulement "aujourd'hui".
  const [selectedNoShow, setSelectedNoShow] = useState<{ bookingId: string; member: BookingMemberRow } | null>(null);

  // Report de RDV (migration 0055, pro/reschedule-propose/route.ts) — le pro
  // propose seulement, le client doit accepter via le lien reçu par email.
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingRow | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeSuccess, setProposeSuccess] = useState(false);
  const [proposedBookingIds, setProposedBookingIds] = useState<Set<string>>(new Set());

  const openReschedule = useCallback((booking: BookingRow) => {
    setRescheduleTarget(booking);
    setRescheduleDate('');
    setRescheduleTime('');
    setRescheduleReason('');
    setProposeError(null);
    setProposeSuccess(false);
  }, []);

  const closeReschedule = useCallback(() => {
    if (proposing) return;
    setRescheduleTarget(null);
  }, [proposing]);

  const submitReschedule = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!rescheduleTarget) return;
      setProposing(true);
      setProposeError(null);
      fetch('/api/pro/reschedule-propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: rescheduleTarget.id,
          proposedDate: rescheduleDate,
          proposedTime: rescheduleTime,
          staffId: rescheduleTarget.staff_id ?? null,
          reason: rescheduleReason.trim() || undefined,
        }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "L'envoi de la proposition a échoué.");
          setProposeSuccess(true);
          setProposedBookingIds((prev) => new Set(prev).add(rescheduleTarget.id));
        })
        .catch((err: Error) => setProposeError(err.message))
        .finally(() => setProposing(false));
    },
    [rescheduleTarget, rescheduleDate, rescheduleTime, rescheduleReason]
  );

  const confirmCancelBooking = useCallback(() => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    fetch('/api/pro/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: cancelTarget.booking.id, memberId: cancelTarget.member.id }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "L'annulation a échoué.");
        setBookings((prev) =>
          prev.map((b) =>
            b.id === cancelTarget.booking.id
              ? { ...b, booking_members: b.booking_members.map((m) => (m.id === cancelTarget.member.id ? { ...m, status: 'cancelled' } : m)) }
              : b
          )
        );
        setCancelTarget(null);
      })
      .catch((e: Error) => setCancelError(e.message))
      .finally(() => setCancelling(false));
  }, [cancelTarget]);

  const handleRefundGesture = useCallback(async () => {
    if (!selectedNoShow) return;
    await fetch('/api/pro/refund-gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: selectedNoShow.bookingId, memberId: selectedNoShow.member.id }),
    });
    setBookings((prev) =>
      prev.map((b) =>
        b.id === selectedNoShow.bookingId
          ? {
              ...b,
              booking_members: b.booking_members.map((m) =>
                m.id === selectedNoShow.member.id ? { ...m, status: 'cancelled' } : m
              ),
            }
          : b
      )
    );
    // Ne ferme plus la modale ici (trouvé le 20/08, chantier confirmation
    // remboursement) : FicheClientIntelligente affiche désormais un retour
    // "✓ Remboursement envoyé" après succès — fermer immédiatement
    // l'empêchait de jamais s'afficher. Le pro ferme lui-même via "Fermer".
  }, [selectedNoShow]);

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

  // C15 (annulation pro) rembourse le client dépôt + frais de gestion —
  // voir proCancellationRefundAmountCents dans lib/refunds.ts — puis
  // refacture ces mêmes frais de gestion au pro (pro_charges). Le prix du
  // service est déjà chargé côté client (services(price), bookings-month) :
  // calcFraisGestion() donne la même estimation que celle affichée au
  // client au moment de payer — pas garanti au centime près si un palier a
  // été surchargé côté admin, mais infiniment plus juste que d'annoncer
  // l'inverse de ce qui va réellement se passer.
  const cancelDeposit = cancelTarget?.member.deposit ?? 0;
  const cancelServicePrice = cancelTarget?.booking.services?.price ?? null;
  const cancelManagementFee = cancelServicePrice != null ? calcFraisGestion(cancelServicePrice) : null;
  const cancelTotalRefund = cancelDeposit + (cancelManagementFee ?? 0);

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
                const rdvMs = parseParisDatetime(b.date, b.time).getTime();
                const isFutureRdv = rdvMs > Date.now();
                const marginHours = (rdvMs - Date.now()) / (1000 * 60 * 60);
                // Portée décision 15/08 : réservations individuelles uniquement.
                const canReschedule = isFutureRdv && !b.group_ref;
                const rescheduleTooSoon = canReschedule && marginHours < RESCHEDULE_MIN_MARGIN_HOURS;
                const alreadyProposed = proposedBookingIds.has(b.id);
                return (
                  <div key={b.id} className="px-4 py-3">
                    <div className="mb-2 flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 font-mono text-sm font-bold text-white">
                        {formatTime(b.time)}
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
                                <>
                                  <button
                                    onClick={() => setSelectedCaisse({ booking: b, member: m })}
                                    className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-navy-950"
                                    style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)' }}
                                  >
                                    Clôturer
                                  </button>
                                  {isFutureRdv && (
                                    <button
                                      onClick={() => setCancelTarget({ booking: b, member: m })}
                                      className="rounded-full border border-rose-500/40 px-2.5 py-0.5 text-[10px] font-semibold text-rose-400 hover:bg-rose-500/10"
                                    >
                                      Annuler
                                    </button>
                                  )}
                                  {canReschedule && !rescheduleTooSoon && !alreadyProposed && (
                                    <button
                                      onClick={() => openReschedule(b)}
                                      className="rounded-full border border-sky-500/40 px-2.5 py-0.5 text-[10px] font-semibold text-sky-400 hover:bg-sky-500/10"
                                    >
                                      Reporter
                                    </button>
                                  )}
                                  {canReschedule && alreadyProposed && (
                                    <span className="rounded-full border border-sky-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-sky-400/60">
                                      Report envoyé
                                    </span>
                                  )}
                                </>
                              ) : m.status === 'no_show' ? (
                                <>
                                  <span
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                    style={{ background: cfg.color, color: cfg.text }}
                                  >
                                    {cfg.label}
                                  </span>
                                  <button
                                    onClick={() => setSelectedNoShow({ bookingId: b.id, member: m })}
                                    className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] font-semibold text-white/70 hover:bg-white/10"
                                  >
                                    Voir la fiche
                                  </button>
                                </>
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
                    {rescheduleTooSoon && (
                      <p className="mt-1.5 pl-[60px] text-[10px] text-white/40">
                        Report impossible à moins de 2h du RDV — utilise l&apos;annulation directe.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedCaisse && (
        <Modal
          onClose={() => setSelectedCaisse(null)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          panelClassName="w-full max-w-sm"
          ariaLabel="Caisse — clôture de la prestation"
          closeOnBackdrop={false}
        >
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
        </Modal>
      )}

      {selectedNoShow && (
        <Modal
          onClose={() => setSelectedNoShow(null)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          panelClassName="w-full max-w-sm"
          ariaLabel="Décision no-show"
          closeOnBackdrop={false}
        >
            <FicheClientIntelligente
              member={selectedNoShow.member}
              onRembourser={handleRefundGesture}
            />
            <button onClick={() => setSelectedNoShow(null)} className="mt-2 w-full rounded-xl bg-navy-900 border border-white/[0.08] py-2.5 text-xs text-slate-400 hover:text-white transition-colors">
              Fermer
            </button>
        </Modal>
      )}

      {cancelTarget && (
        <Modal
          onClose={() => {
            if (cancelling) return;
            setCancelTarget(null);
            setCancelError(null);
          }}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          panelClassName="w-full max-w-sm rounded-2xl border border-white/10 bg-navy-900 p-5"
          ariaLabel="Annuler ce rendez-vous"
          closeOnBackdrop={!cancelling}
        >
          <h3 className="text-sm font-semibold text-white">Annuler ce rendez-vous ?</h3>
          <p className="mt-2 text-xs text-white/60">
            Client : <span className="font-semibold text-white">{cancelTarget.member.name || 'Participant'}</span>
          </p>
          <p className="mt-1 text-xs text-white/60">
            Montant remboursé au client :{' '}
            <span className="font-semibold text-white">{cancelTotalRefund.toFixed(2)}€</span>{' '}
            {cancelManagementFee != null ? (
              <>
                (frais de réservation {cancelDeposit}€ + frais de gestion {cancelManagementFee.toFixed(2)}€ —
                remboursement intégral, le client n&apos;est pas en faute).
              </>
            ) : (
              <>(remboursement intégral incluant les frais de gestion — le client n&apos;est pas en faute).</>
            )}
          </p>
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-300">
            Les frais de gestion{cancelManagementFee != null ? ` (${cancelManagementFee.toFixed(2)}€)` : ''} vous
            seront refacturés sur une prochaine facture — c&apos;est vous, pas le client, qui les prenez en
            charge sur cette annulation.
          </p>
          <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-medium text-rose-300">
            Action irréversible : le créneau sera libéré et le client sera notifié par email.
          </p>
          {cancelError && (
            <p role="alert" className="mt-2 text-[11px] font-medium text-rose-400">
              {cancelError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setCancelTarget(null);
                setCancelError(null);
              }}
              disabled={cancelling}
              className="flex-1 rounded-xl border border-white/[0.08] bg-navy-800 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={confirmCancelBooking}
              disabled={cancelling}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
            >
              {cancelling ? 'Annulation...' : 'Confirmer l\'annulation'}
            </button>
          </div>
        </Modal>
      )}

      {rescheduleTarget && (
        <Modal
          onClose={closeReschedule}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          panelClassName="w-full max-w-sm rounded-2xl border border-white/10 bg-navy-900 p-5"
          ariaLabel="Proposer un nouveau créneau"
          closeOnBackdrop={!proposing}
        >
          {proposeSuccess ? (
            <>
              <h3 className="text-sm font-semibold text-white">Proposition envoyée</h3>
              <p className="mt-2 text-xs text-white/60">
                Le client a reçu un email avec le nouveau créneau. Le RDV reste sur{' '}
                <span className="font-semibold text-white">
                  {rescheduleTarget.date} à {formatTime(rescheduleTarget.time)}
                </span>{' '}
                tant qu&apos;il n&apos;a pas répondu — rien ne change de ton côté avant son acceptation.
              </p>
              <button
                onClick={closeReschedule}
                className="mt-4 w-full rounded-xl bg-navy-800 border border-white/[0.08] py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Fermer
              </button>
            </>
          ) : (
            <form onSubmit={submitReschedule}>
              <h3 className="text-sm font-semibold text-white">Proposer un nouveau créneau</h3>
              <p className="mt-2 text-xs text-white/60">
                RDV actuel :{' '}
                <span className="font-semibold text-white">
                  {rescheduleTarget.date} à {formatTime(rescheduleTarget.time)}
                </span>{' '}
                — {rescheduleTarget.service_name}
              </p>
              <p className="mt-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] font-medium text-sky-300">
                Ceci n&apos;est qu&apos;une proposition : le client doit l&apos;accepter en ligne. Le RDV reste
                inchangé tant qu&apos;il n&apos;a pas répondu ou après un refus/expiration.
              </p>

              <label className="mt-3 block text-[11px] font-medium text-white/50">Nouvelle date</label>
              <input
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-sky-500"
              />

              <label className="mt-3 block text-[11px] font-medium text-white/50">Nouvelle heure</label>
              <input
                type="time"
                required
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-sky-500"
              />

              <label className="mt-3 block text-[11px] font-medium text-white/50">Motif (optionnel, visible par le client)</label>
              <textarea
                rows={2}
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="Ex. absence imprévue"
                className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-sky-500"
              />

              {proposeError && (
                <p role="alert" className="mt-2 text-[11px] font-medium text-rose-400">
                  {proposeError}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={closeReschedule}
                  disabled={proposing}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-navy-800 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50"
                >
                  Retour
                </button>
                <button
                  type="submit"
                  disabled={proposing}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 transition-colors disabled:opacity-50"
                >
                  {proposing ? 'Envoi...' : 'Envoyer la proposition'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
