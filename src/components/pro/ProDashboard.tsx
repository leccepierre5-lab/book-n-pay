'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import type { Business } from '@/lib/database.types';
import type { ProStats } from '@/lib/queries/pro';
import { formatTime } from '@/lib/booking-utils';
import QRScanner from './QRScanner';
import ProCalendar from './ProCalendar';
import FicheClientIntelligente from './FicheClientIntelligente';
import CaisseEncaissement from './CaisseEncaissement';
import AlertsPanel from './AlertsPanel';
import { getStripeRequirementsBannerLevel, type StripeRequirementsBannerInput } from '@/lib/stripe-requirements';
import type { StaffQuotaStatus } from '@/lib/plans-config';

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

interface RecentNoShowRow {
  id: string;
  service_name: string;
  date: string;
  time: string;
  booking_members: BookingMemberRow[];
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
  stripeRequirements,
  notificationPrefs,
  staffQuota,
  recentNoShows,
}: {
  business: Business;
  todayBookings: BookingRow[];
  stats: ProStats;
  stripeConnected: boolean;
  stripeRequirements?: StripeRequirementsBannerInput | null;
  notificationPrefs?: Record<string, boolean> | null;
  staffQuota?: StaffQuotaStatus | null;
  recentNoShows?: RecentNoShowRow[];
}) {
  const [bookings, setBookings] = useState(todayBookings);
  const [connectLoading, setConnectLoading] = useState(false);
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [stripeConnectedLocal, setStripeConnectedLocal] = useState(stripeConnected);
  const [view, setView] = useState<'today' | 'calendar'>('today');
  const [selectedNoShow, setSelectedNoShow] = useState<{ bookingId: string; member: BookingMemberRow } | null>(null);
  // Alerte "no-show" (20/08) — voir getRecentNoShows.ts pour le pourquoi de
  // la fenêtre 7 jours. N'affiche que les no-shows PAS déjà remboursés dans
  // cette session (retirés localement après un geste) : rien ne persiste
  // "traité" en base, donc un no-show simplement consulté sans geste
  // réapparaît tant que la page n'est pas rechargée.
  const [recentNoShowsLocal, setRecentNoShowsLocal] = useState(recentNoShows ?? []);
  const [noShowListOpen, setNoShowListOpen] = useState(false);
  const [selectedCaisse, setSelectedCaisse] = useState<{ booking: BookingRow; member: BookingMemberRow } | null>(null);
  const [markingNoShow, setMarkingNoShow] = useState<string | null>(null);
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
    setRecentNoShowsLocal((prev) => prev.filter((b) => b.booking_members[0]?.id !== selectedNoShow.member.id));
    // Ne ferme plus la modale ici (trouvé le 20/08, chantier confirmation
    // remboursement) : FicheClientIntelligente affiche désormais un retour
    // "✓ Remboursement envoyé" après succès — fermer immédiatement
    // l'empêchait de jamais s'afficher. Le pro ferme lui-même via "Fermer".
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
      const staffName = data.booking?.staff_name;
      setScanFeedback(`✓ Check-in : ${data.member.name}${staffName ? ` · avec ${staffName}` : ''}`);
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
    setMarkingNoShow(memberId);
    const res = await fetch('/api/bookings/update-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, memberId, updates: { status: 'no_show' } }),
    });
    setMarkingNoShow(null);
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

  const stripeRequirementsLevel = stripeConnectedLocal && stripeRequirements
    ? getStripeRequirementsBannerLevel(stripeRequirements)
    : null;

  const handleStripeRemediation = async () => {
    setRemediationLoading(true);
    const res = await fetch('/api/pro/stripe/remediation', { method: 'POST' });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setRemediationLoading(false);
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
    <div className="min-h-dvh">
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
              href="/pro/prestations"
              className="flex items-center gap-1.5 rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
            >
              Prestations
            </Link>
            <Link
              href="/pro/planning"
              className="flex items-center gap-1.5 rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
            >
              Planning
            </Link>
            <Link
              href="/pro/equipe"
              className="flex items-center gap-1.5 rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
            >
              Équipe
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

        <AlertsPanel bookings={bookings} notificationPrefs={notificationPrefs} />

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

        {/* Bloc C — exigences Stripe 2026 sur le compte Connect. Texte
            volontairement générique : les codes bruts (currently_due, ex.
            "individual.verification.document") ne sont jamais montrés au
            pro, le bouton suffit — Stripe précise lui-même ce qu'il attend
            une fois sur son flux hébergé. */}
        {stripeRequirementsLevel && (
          <div
            className={
              'mb-5 rounded-2xl border p-4 ' +
              (stripeRequirementsLevel === 'red'
                ? 'border-red-500/25 bg-red-500/8'
                : stripeRequirementsLevel === 'orange'
                ? 'border-amber-500/25 bg-amber-500/8'
                : 'border-blue-500/25 bg-blue-500/8')
            }
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className={
                  'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ' +
                  (stripeRequirementsLevel === 'red'
                    ? 'bg-red-500/15'
                    : stripeRequirementsLevel === 'orange'
                    ? 'bg-amber-500/15'
                    : 'bg-blue-500/15')
                }
              >
                <svg
                  className={
                    'w-4 h-4 ' +
                    (stripeRequirementsLevel === 'red'
                      ? 'text-red-400'
                      : stripeRequirementsLevel === 'orange'
                      ? 'text-amber-400'
                      : 'text-blue-400')
                  }
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className={
                  'text-sm font-semibold ' +
                  (stripeRequirementsLevel === 'red'
                    ? 'text-red-300'
                    : stripeRequirementsLevel === 'orange'
                    ? 'text-amber-300'
                    : 'text-blue-300')
                }>
                  {stripeRequirementsLevel === 'red'
                    ? 'Vos virements Stripe sont suspendus'
                    : stripeRequirementsLevel === 'orange'
                    ? 'Informations Stripe à compléter rapidement'
                    : 'Stripe demandera bientôt des informations complémentaires'}
                </p>
                <p className={
                  'text-xs mt-0.5 ' +
                  (stripeRequirementsLevel === 'red'
                    ? 'text-red-400/70'
                    : stripeRequirementsLevel === 'orange'
                    ? 'text-amber-400/70'
                    : 'text-blue-400/70')
                }>
                  {stripeRequirementsLevel === 'red'
                    ? "Stripe a besoin d'informations supplémentaires pour reprendre vos paiements."
                    : stripeRequirementsLevel === 'orange'
                    ? "Sans action de votre part avant l'échéance, vos virements seront suspendus."
                    : "Rien d'urgent — préparez-le tranquillement avant l'échéance indiquée par Stripe."}
                </p>
              </div>
            </div>
            <button
              onClick={handleStripeRemediation}
              disabled={remediationLoading}
              className={
                'w-full rounded-xl py-2.5 text-sm font-semibold text-navy-950 transition-all disabled:opacity-50 ' +
                (stripeRequirementsLevel === 'red'
                  ? 'bg-red-400'
                  : stripeRequirementsLevel === 'orange'
                  ? 'bg-amber-400'
                  : 'bg-blue-400')
              }
            >
              {remediationLoading ? '...' : 'Mettre à jour mes informations Stripe →'}
            </button>
          </div>
        )}

        {/* Quota de collaborateurs dépassé (14/08) — atteignable uniquement
            par un downgrade Stripe (voir subscription-sync.ts) : plans-
            config.ts:getStaffQuotaStatus. Décision actée : avertissement
            seul, JAMAIS de désactivation automatique (des RDV peuvent être
            assignés à un collaborateur au-dessus du quota). */}
        {staffQuota?.overQuota && (
          <div className="mb-5 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-300">Quota de collaborateurs dépassé</p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  Votre formule autorise {staffQuota.max} collaborateur{staffQuota.max === 1 ? '' : 's'}, vous en avez {staffQuota.active} actif{staffQuota.active === 1 ? '' : 's'}.
                  {' '}Passez à la formule supérieure ou désactivez-en {staffQuota.excess}.
                </p>
              </div>
            </div>
            <Link
              href="/pro/equipe"
              className="block w-full text-center rounded-xl py-2.5 text-sm font-semibold text-navy-950 bg-amber-400 transition-all"
            >
              Gérer mon équipe →
            </Link>
          </div>
        )}

        {/* Information no-show (20/08, reformulée le même jour) — voir
            getRecentNoShows (lib/queries/pro.ts) pour le pourquoi de la
            fenêtre 7 jours. Ton neutre volontaire : par défaut le pro n'a
            RIEN à faire, les frais de réservation sont déjà acquis — ce
            n'est pas une alerte, c'est une information + une option
            facultative (le geste commercial). L'ancienne version (rouge,
            triangle, "en attente d'une décision") laissait croire le
            contraire. */}
        {recentNoShowsLocal.length > 0 && (
          <div className="mb-5 rounded-2xl border border-white/[0.08] bg-navy-900 p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {recentNoShowsLocal.length} no-show{recentNoShowsLocal.length === 1 ? '' : 's'} ces 7 derniers jours
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Les frais de réservation vous sont déjà acquis. Si vous le souhaitez, vous pouvez rembourser ce client en geste commercial.
                </p>
              </div>
            </div>
            <button
              onClick={() => setNoShowListOpen(true)}
              className="block w-full text-center rounded-xl py-2.5 text-sm font-semibold text-white border border-white/15 hover:bg-white/5 transition-all"
            >
              {recentNoShowsLocal.length === 1 ? 'Voir le client →' : 'Voir les clients →'}
            </button>
          </div>
        )}

        {/* Stats grid — état dédié si le pro démarre (0 réservation ce mois),
            évite le mur de zéros identifié en audit (19/07) sur le premier
            écran vu par un pro fraîchement inscrit. */}
        {stats.totalBookings === 0 && stats.upcomingCount === 0 ? (
          <div className="mb-6 rounded-2xl bg-navy-900 border border-white/[0.08] p-5 text-center">
            <p className="text-2xl mb-2">🚀</p>
            <p className="text-sm font-semibold text-white mb-1">Aucune réservation pour l'instant</p>
            <p className="text-xs text-slate-500">Tes statistiques (CA, no-show, réservations) apparaîtront ici dès ta première réservation.</p>
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3">
            {[
              // Audit 26/07 : "CA ce mois" ne comptait que les frais de
              // réservation perçus en ligne par Book'nPay — jamais le solde
              // de la prestation encaissé sur place par le pro (app/tpe/
              // espèces). Deux tuiles distinctes plutôt qu'un total unique
              // qui aurait sous-évalué le vrai chiffre d'affaires du pro.
              { label: 'Perçu en ligne', value: `${stats.onlineRevenue}€`, color: 'text-mint-400', icon: '💳' },
              { label: 'Encaissé sur place', value: `${stats.onSiteRevenue}€`, color: 'text-mint-400', icon: '💰' },
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
        )}

        {/* Ce que Book'nPay vous apporte — 2 métriques factuelles retenues
            après relecture (19/07) : "temps gagné" écarté (hypothèse non
            mesurée, pas montré à un pro qui paie un abonnement tant qu'il
            n'y a pas de vraie mesure). Le 1er chiffre est un CUMUL depuis
            l'inscription (voir getProStats) — délibérément indépendant du
            gate "je démarre" ci-dessus (basé sur le mois courant) : un pro
            avec un mois calme mais un historique réel ne doit pas revoir
            un message "vous démarrez" qui masquerait sa vraie valeur cumulée. */}
        {stats.depositSecuredCount > 0 && (
          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ce que Book'nPay vous apporte depuis votre inscription</p>
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
              <p className="text-sm text-white">
                <span className="font-bold text-mint-400">{stats.depositSecuredCount}</span> RDV sécurisé{stats.depositSecuredCount > 1 ? 's' : ''} par frais de réservation
                <span className="text-slate-500"> · </span>
                <span className="font-bold text-mint-400">{stats.depositSecuredAmount.toFixed(2).replace('.', ',')}{' '}€</span> encaissés d'avance sur vos réservations — conservés si le client ne vient pas
              </p>
            </div>
            {/* Gate propre à cette carte (pas seulement au bloc parent, ligne
                477) : ce compteur peut être à 0 même quand depositSecuredCount
                est positif — trouvé le 21/08, affichait "0 réservation...
                hors de vos horaires" suivi d'une phrase vantant un bénéfice
                inexistant. */}
            {stats.offHoursBookingsCount > 0 && (
              <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
                <p className="text-sm text-white">
                  <span className="font-bold text-blue-400">{stats.offHoursBookingsCount}</span> réservation{stats.offHoursBookingsCount > 1 ? 's' : ''} prise{stats.offHoursBookingsCount > 1 ? 's' : ''} ce mois-ci hors de vos horaires d'ouverture
                </p>
                <p className="text-xs text-slate-500 mt-1">Des clients que vous n'auriez pas pu décrocher au téléphone.</p>
              </div>
            )}
          </div>
        )}

        {/* Frais de gestion refacturés suite à VOS annulations de RDV (C15,
            pro/cancel-booking) — depuis le 11/08, le client est intégralement
            remboursé quand vous annulez, les frais de gestion vous sont donc
            refacturés en contrepartie. Toujours visible dès qu'il y a un
            montant en attente, indépendamment du gate "je démarre" ci-dessus
            (une charge en attente reste due même sur un mois par ailleurs
            calme). Sans cette ligne, c'est exactement le frais caché reproché
            à la concurrence — carte dédiée (pas fondue dans "Ce que Book'nPay
            vous apporte" : ceci est un montant que le pro DOIT, pas une
            valeur reçue).
            Libellé "à refacturer", PAS "ce mois" (relecture 11/08, même
            classe d'erreur que le bug CA `0655d92`) : proChargesPendingAmount
            est un cumul de TOUTES les charges 'pending' depuis toujours — un
            libellé "ce mois" serait faux dès le deuxième mois d'activité.
            Facturation effective (13/08) : une charge quitte ce cumul dès
            qu'elle passe 'invoiced' (rattachée à la prochaine facture
            d'abonnement, ou à une facture autonome si le pro résilie avant),
            jamais sur une base calendaire — voir pro-charge-billing.ts. */}
        {stats.proChargesPendingAmount > 0 && (
          <div className="mb-6 rounded-2xl bg-navy-900 border border-amber-500/20 p-4">
            <p className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
              <span>🧾</span>Frais de gestion à refacturer
            </p>
            <p className="text-2xl font-bold text-amber-400">{stats.proChargesPendingAmount}€</p>
            <p className="text-xs text-slate-500 mt-1">
              Suite à vos annulations de rendez-vous (client remboursé intégralement) — prélevés sur une prochaine facture.
            </p>
          </div>
        )}

        {/* Historique de ce qui a déjà été facturé — distinct du bloc "à
            refacturer" ci-dessus, jamais fondu dedans : le pro doit pouvoir
            vérifier CE QUI est parti et QUAND, pas seulement le cumul en
            attente (règle posée le 13/08, facturation effective). */}
        {stats.proChargesInvoiced.length > 0 && (
          <div className="mb-6 rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
            <p className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
              <span>✅</span>Frais de gestion déjà facturés
            </p>
            <ul className="space-y-1">
              {stats.proChargesInvoiced.map((c, i) => (
                <li key={i} className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {new Date(c.invoicedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                  <span className="font-semibold text-white">{c.amount.toFixed(2)}€</span>
                </li>
              ))}
            </ul>
          </div>
        )}

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

        {/* Liste des no-shows en attente (20/08) — déclenchée par la bannière ci-dessus. */}
        {noShowListOpen && (
          <Modal
            onClose={() => setNoShowListOpen(false)}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
            panelClassName="w-full max-w-sm"
            ariaLabel="No-shows en attente d'une décision"
          >
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.05]">
                <p className="text-sm font-semibold text-white">No-shows en attente (7 derniers jours)</p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {recentNoShowsLocal.map((b) => {
                  const m = b.booking_members[0];
                  if (!m) return null;
                  return (
                    <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{m.name}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {b.service_name} · {new Date(b.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à {formatTime(b.time)}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setNoShowListOpen(false);
                          setSelectedNoShow({ bookingId: b.id, member: m });
                        }}
                        className="shrink-0 rounded-xl bg-navy-800 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-navy-700 transition-all"
                      >
                        Voir la fiche
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <button onClick={() => setNoShowListOpen(false)} className="mt-2 w-full rounded-xl bg-navy-900 border border-white/[0.08] py-2.5 text-xs text-slate-400 hover:text-white transition-colors">
              Fermer
            </button>
          </Modal>
        )}

        {/* No-show modal */}
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

        {/* Caisse modal */}
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
                    <p className="text-sm font-semibold text-white">{formatTime(b.time)} · {b.service_name}</p>
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
                              disabled={markingNoShow === m.id}
                              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-navy-950 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 2px 8px rgba(52,211,153,0.3)' }}
                            >
                              Check-in
                            </button>
                            <button
                              onClick={() => markNoShow(b.id, m.id)}
                              disabled={markingNoShow === m.id}
                              className="rounded-xl bg-red-500/12 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {markingNoShow === m.id ? '...' : 'No-show'}
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
