'use client';
// src/components/pro/ProDashboard.tsx
// Tableau de bord pro condensé : réservations du jour avec check-in,
// stats rapides, statut Stripe Connect. Périmètre volontairement plus
// resserré que ProSpace.jsx (709 lignes) — voir README pour la liste des
// panels Base44 non encore portés (Messages, Caisse, Alertes, FicheClient...).
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
  const [selectedNoShow, setSelectedNoShow] = useState<{ bookingId: string; member: BookingMemberRow } | null>(
    null
  );
  const [selectedCaisse, setSelectedCaisse] = useState<{ booking: BookingRow; member: BookingMemberRow } | null>(
    null
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  // ⚠️ CORRECTIF (trouvé par trace bout-en-bout) : /api/stripe/connect-status
  // est la SEULE route qui passe stripe_onboarding_complete à true en base,
  // mais rien ne l'appelait jamais côté front. Un pro qui terminait son
  // onboarding Stripe Express revenait sur ?stripe_return=1 sans que rien
  // ne se passe — son statut restait `false` indéfiniment, l'empêchant de
  // recevoir des transferts directs (le checkout vérifie ce champ avant
  // d'activer application_fee_amount/transfer_data). Corrigé en appelant
  // connect-status automatiquement à la détection de ce paramètre.
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

  const handleKeepFees = () => {
    // Rien à faire côté serveur : les frais restent acquis par défaut,
    // le statut 'no_show' reste tel quel. On ferme juste la fiche.
    setSelectedNoShow(null);
  };

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
      setScanFeedback(`✓ Check-in effectué pour ${data.member.name}`);
      setBookings((prev) =>
        prev.map((b) =>
          b.id === data.booking?.id
            ? {
                ...b,
                booking_members: b.booking_members.map((m) =>
                  m.id === data.member.id ? { ...m, status: 'arrived' } : m
                ),
              }
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
            ? {
                ...b,
                booking_members: b.booking_members.map((m) =>
                  m.id === memberId ? { ...m, status: 'no_show' } : m
                ),
              }
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

  const statusLabel: Record<string, string> = {
    invite: 'En attente',
    paid: 'Payé',
    arrived: 'Arrivé',
    no_show: 'No-show',
    cancelled: 'Annulé',
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">{business.name}</h1>
            <p className="text-sm text-white/50">Espace pro</p>
          </div>
          <Link href="/pro/transactions" className="text-sm text-mint-400">
            Transactions →
          </Link>
          <Link href="/pro/reglages" className="ml-3 text-sm text-white/50 hover:text-white">
            ⚙️
          </Link>
        </header>

        <AlertsPanel bookings={bookings} />

        <button
          onClick={() => setScannerOpen(true)}
          className="mb-5 w-full rounded-xl bg-navy-900 py-3 text-sm font-medium text-white hover:bg-navy-800"
        >
          📷 Scanner un QR code client
        </button>

        {scanFeedback && (
          <div className="mb-4 rounded-lg bg-navy-900 px-4 py-2 text-sm text-mint-400">
            {scanFeedback}
          </div>
        )}

        {scannerOpen && <QRScanner onScan={handleQrScan} onClose={() => setScannerOpen(false)} />}

        {selectedNoShow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-sm">
              <FicheClientIntelligente
                member={selectedNoShow.member}
                onRembourser={handleRefundGesture}
                onGarder={handleKeepFees}
              />
              <button
                onClick={() => setSelectedNoShow(null)}
                className="mt-2 w-full rounded-lg bg-navy-900 py-2 text-xs text-white/60"
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {selectedCaisse && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-sm">
              <CaisseEncaissement
                member={selectedCaisse.member}
                booking={selectedCaisse.booking}
                onValidatePresence={() => {
                  setBookings((prev) =>
                    prev.map((b) =>
                      b.id === selectedCaisse.booking.id
                        ? {
                            ...b,
                            booking_members: b.booking_members.map((m) =>
                              m.id === selectedCaisse.member.id ? { ...m, status: 'arrived' } : m
                            ),
                          }
                        : b
                    )
                  );
                }}
              />
              <button
                onClick={() => setSelectedCaisse(null)}
                className="mt-2 w-full rounded-lg bg-navy-900 py-2 text-xs text-white/60"
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {!stripeConnectedLocal && (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="mb-2 text-sm text-amber-300">
              ⚠️ Active Stripe Connect pour recevoir tes paiements directement sur ton compte.
            </p>
            <button
              onClick={connectStripe}
              disabled={connectLoading}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-navy-950 disabled:opacity-50"
            >
              {connectLoading ? '...' : 'Activer Stripe Connect'}
            </button>
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-navy-900 p-4">
            <p className="text-xs text-white/50">CA ce mois</p>
            <p className="text-lg font-semibold text-mint-400">{stats.totalRevenue}€</p>
          </div>
          <div className="rounded-xl bg-navy-900 p-4">
            <p className="text-xs text-white/50">Taux no-show</p>
            <p className="text-lg font-semibold text-white">{stats.noShowRate}%</p>
          </div>
          <div className="rounded-xl bg-navy-900 p-4">
            <p className="text-xs text-white/50">Réservations ce mois</p>
            <p className="text-lg font-semibold text-white">{stats.totalBookings}</p>
          </div>
          <div className="rounded-xl bg-navy-900 p-4">
            <p className="text-xs text-white/50">À venir</p>
            <p className="text-lg font-semibold text-white">{stats.upcomingCount}</p>
          </div>
        </div>

        <h2 className="mb-3 text-sm font-medium text-white/70">Réservations</h2>

        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setView('today')}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              view === 'today' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Aujourd'hui
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              view === 'calendar' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Calendrier
          </button>
        </div>

        {view === 'calendar' ? (
          <ProCalendar bizId={business.id} />
        ) : (
        <div className="space-y-3">
          {bookings.length === 0 && (
            <p className="py-6 text-center text-sm text-white/40">Aucune réservation aujourd'hui.</p>
          )}
          {bookings.map((b) => (
            <div key={b.id} className="rounded-xl bg-navy-900 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  {b.time} — {b.service_name}
                </p>
                {b.staff_name && <p className="text-xs text-white/50">{b.staff_name}</p>}
              </div>
              <div className="space-y-2">
                {b.booking_members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-navy-800 p-2">
                    <div>
                      <p className="text-sm text-white">{m.name}</p>
                      <p className="text-xs text-white/40">{statusLabel[m.status] || m.status}</p>
                    </div>
                    {m.status === 'paid' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedCaisse({ booking: b, member: m })}
                          className="rounded-lg bg-mint-500 px-3 py-1 text-xs font-medium text-navy-950"
                        >
                          Encaisser / Check-in
                        </button>
                        <button
                          onClick={() => markNoShow(b.id, m.id)}
                          className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-300"
                        >
                          No-show
                        </button>
                      </div>
                    )}
                    {m.status === 'no_show' && (
                      <button
                        onClick={() => setSelectedNoShow({ bookingId: b.id, member: m })}
                        className="rounded-lg bg-navy-800 px-3 py-1 text-xs text-white/70 hover:bg-navy-700"
                      >
                        Voir la fiche
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
