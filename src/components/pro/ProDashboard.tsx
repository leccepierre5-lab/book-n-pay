'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Business } from '@/lib/database.types';
import type { ProStats } from '@/lib/queries/pro';
import QRScanner from './QRScanner';
import ProCalendar from './ProCalendar';
import FicheClientIntelligente from './FicheClientIntelligente';
import CaisseEncaissement from './CaisseEncaissement';
import AlertsPanel from './AlertsPanel';

interface BookingMemberRow {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  deposit: number | null;
  payment_mode: string | null;
}

interface BookingRow {
  id: string;
  date: string;
  time: string;
  service_name: string;
  staff_name: string | null;
  status: string;
  booking_members: BookingMemberRow[];
  services?: { price: number } | null;
}

const MEMBER_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  invite: { label: 'En attente', dot: 'bg-amber-400', badge: 'text-amber-300 bg-amber-500/12 border-amber-500/20' },
  paid: { label: 'Confirmé', dot: 'bg-mint-400', badge: 'text-mint-400 bg-mint-500/12 border-mint-500/20' },
  arrived: { label: 'Arrivé', dot: 'bg-emerald-400', badge: 'text-emerald-400 bg-emerald-500/12 border-emerald-500/20' },
  no_show: { label: 'No-show', dot: 'bg-red-400', badge: 'text-red-400 bg-red-500/12 border-red-500/20' },
  cancelled: { label: 'Annulé', dot: 'bg-slate-500', badge: 'text-slate-500 bg-white/5 border-white/10' },
};

export default function ProDashboard({
  business,
  todayBookings,
  stats,
  stripeConnected,
}: {
  business: Business;
  todayBookings: BookingRow[];
  stats: ProStats;
  stripeConnected: boolean;
}) {
  const [bookings, setBookings] = useState(todayBookings);
  const [connectLoading, setConnectLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [stripeConnectedLocal, setStripeConnectedLocal] = useState(stripeConnected);
  const [view, setView] = useState<'today' | 'calendar'>('today');
  const [selectedNoShow, setSelectedNoShow] = useState<{ bookingId: string; member: BookingMemberRow } | null>(null);
  const [selectedCaisse, setSelectedCaisse] = useState<{ booking: BookingRow; member: BookingMemberRow } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('stripe_return') !== '1') return;
    fetch('/api/stripe/connect-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bizId: business.id }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.onboardingComplete) setStripeConnectedLocal(true);
      })
      .finally(() => {
        router.replace('/pro');
      });
  }, [searchParams, business.id, router]);

  const handleRefundGesture = async () => {
    if (!selectedNoShow) return;
    await fetch('/api/pro/refund-gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: selectedNoShow.bookingId, memberId: selectedNoShow.member.id }),
    });
    setSelectedNoShow(null);
  };

  const handleKeepFees = () => setSelectedNoShow(null);

  const handleQrScan = async (qrCode: string) => {
    setScannerOpen(false);
    const res = await fetch('/api/bookings/checkin-by-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      setScanFeedback(data.error || 'QR code introuvable');
    } else if (data.alreadyCheckedIn) {
      setScanFeedback('Ce client est déjà enregistré comme arrivé.');
    } else {
      setScanFeedback(`✓ Check-in : ${data.member.name}`);
      setBookings((prev) =>
        prev.map((b) =>
          b.id === data.booking?.id
            ? { ...b, booking_members: b.booking_members.map((m) => m.id === data.member.id ? { ...m, status: 'arrived' } : m) }
            : b
        )
      );
    }
    setTimeout(() => setScanFeedback(null), 4000);
  };

  const markNoShow = async (bookingId: string, memberId: string) => {
    const res = await fetch('/api/bookings/update-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, memberId, updates: { status: 'no_show' } }),
    });
    if (res.ok) {
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? { ...b, booking_members: b.booking_members.map((m) => m.id === memberId ? { ...m, status: 'no_show' } : m) }
            : b
        )
      );
    }
  };

  const connectStripe = async () => {
    setConnectLoading(true);
    const res = await fetch('/api/stripe/connect-onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bizId: business.id,
        bizName: business.name,
        returnUrl: `${window.location.origin}/pro?stripe_return=1`,
      }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setConnectLoading(false);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-6">

        {/* Header */}
        <header className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold text-mint-500/60 uppercase tracking-widest mb-1">Espace Pro</p>
            <h1 className="text-xl font-bold text-white leading-tight">{business.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/pro/flash-slots"
              className="flex items-center gap-1.5 rounded-xl bg-navy-900 border border-mint-500/20 px-3 py-1.5 text-xs font-semibold text-mint-400 hover:bg-navy-800 transition-all"
            >
              ⚡ Flash
            </Link>
            <Link
              href="/pro/transactions"
              className="flex items-center gap-1.5 rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
            >
              Transactions
            </Link>
            <Link
              href="/pro/profil"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-navy-900 border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/15 transition-all"
              title="Mon profil public"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </Link>
            <Link
              href="/pro/reglages"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-navy-900 border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/15 transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </Link>
          </div>
        </header>

        <AlertsPanel bookings={bookings} />

        {/* Stripe warning */}
        {!stripeConnectedLocal && (
          <div className="mb-5 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-300">Stripe Connect non activé</p>
                <p className="text-xs text-amber-400/70 mt-0.5">Activez pour recevoir les paiements directement.</p>
              </div>
            </div>
            <button
              onClick={connectStripe}
              disabled={connectLoading}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-navy-950 transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', boxShadow: '0 4px 16px rgba(245,158,11,0.3)' }}
            >
              {connectLoading ? '...' : 'Activer Stripe Connect →'}
            </button>
          </div>
        )}

        {/* Stats grid */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          {[
            { label: 'CA ce mois', value: `${stats.totalRevenue}€`, color: 'text-mint-400', icon: '💰' },
            { label: 'Taux no-show', value: `${stats.noShowRate}%`, color: stats.noShowRate > 15 ? 'text-red-400' : 'text-white', icon: '📊' },
            { label: 'Réservations', value: stats.totalBookings, color: 'text-white', icon: '📅' },
            { label: 'À venir', value: stats.upcomingCount, color: 'text-blue-400', icon: '🗓️' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
              <p className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                <span>{s.icon}</span>{s.label}
              </p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* QR Scanner button */}
        <button
          onClick={() => setScannerOpen(true)}
          className="mb-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-navy-900 border border-white/[0.08] py-3.5 text-sm font-semibold text-white hover:bg-navy-800 hover:border-white/15 transition-all"
        >
          <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 7V1h-6M1 17v6h6M7 1H1v6M17 23h6v-6"/><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>
          </svg>
          Scanner un QR code client
        </button>

        {scanFeedback && (
          <div className="mb-4 rounded-2xl bg-mint-500/10 border border-mint-500/25 px-4 py-3">
            <p className="text-sm text-mint-400 font-medium">{scanFeedback}</p>
          </div>
        )}

        {scannerOpen && <QRScanner onScan={handleQrScan} onClose={() => setScannerOpen(false)} />}

        {/* No-show modal */}
        {selectedNoShow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
            <div className="w-full max-w-sm">
              <FicheClientIntelligente
                member={selectedNoShow.member}
                onRembourser={handleRefundGesture}
                onGarder={handleKeepFees}
              />
              <button onClick={() => setSelectedNoShow(null)} className="mt-2 w-full rounded-xl bg-navy-900 border border-white/[0.08] py-2.5 text-xs text-slate-400 hover:text-white transition-colors">
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* Caisse modal */}
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

        {/* View toggle */}
        <div className="flex gap-1 p-1 bg-navy-900 rounded-xl border border-white/[0.06] mb-4">
          {(['today', 'calendar'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all duration-200 ${
                view === v ? 'bg-mint-500 text-navy-950 shadow-[0_0_10px_rgba(52,211,153,0.3)]' : 'text-slate-400 hover:text-white'
              }`}
            >
              {v === 'today' ? "Aujourd'hui" : 'Calendrier'}
            </button>
          ))}
        </div>

        {view === 'calendar' ? (
          <ProCalendar bizId={business.id} />
        ) : (
          <div className="space-y-3">
            {bookings.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-3xl mb-3">🎉</p>
                <p className="text-slate-400 text-sm">Aucune réservation aujourd'hui.</p>
              </div>
            )}
            {bookings.map((b) => (
              <div key={b.id} className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
                  <div>
                    <p className="text-sm font-semibold text-white">{b.time} · {b.service_name}</p>
                    {b.staff_name && <p className="text-xs text-slate-500 mt-0.5">{b.staff_name}</p>}
                  </div>
                  <span className="text-xs text-slate-600 bg-navy-800 border border-white/[0.06] rounded-full px-2 py-0.5">
                    {b.booking_members.length} pers.
                  </span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {b.booking_members.map((m) => {
                    const sc = MEMBER_STATUS[m.status] || MEMBER_STATUS.invite;
                    return (
                      <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{m.name}</p>
                          <span className={`inline-flex items-center gap-1.5 mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </div>
                        {m.status === 'paid' && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => setSelectedCaisse({ booking: b, member: m })}
                              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-navy-950 transition-all"
                              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 2px 8px rgba(52,211,153,0.3)' }}
                            >
                              Check-in
                            </button>
                            <button
                              onClick={() => markNoShow(b.id, m.id)}
                              className="rounded-xl bg-red-500/12 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              No-show
                            </button>
                          </div>
                        )}
                        {m.status === 'no_show' && (
                          <button
                            onClick={() => setSelectedNoShow({ bookingId: b.id, member: m })}
                            className="rounded-xl bg-navy-800 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-navy-700 transition-all shrink-0"
                          >
                            Voir la fiche
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
