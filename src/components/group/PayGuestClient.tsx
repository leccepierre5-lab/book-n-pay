'use client';
import { useState } from 'react';
import { calcFraisGestion } from '@/lib/booking-utils';

interface Booking {
  id: string;
  biz_name: string;
  service_name: string;
  staff_name: string | null;
  date: string;
  time: string;
  service_id: string;
  services: { deposit: number; price: number } | null;
}

interface Member {
  id: string;
  name: string | null;
  booking_id: string;
}

export default function PayGuestClient({ member, booking }: { member: Member; booking: Booking }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deposit = booking.services?.deposit ?? 0;
  const fraisGestion = calcFraisGestion(booking.services?.price ?? 0);
  const total = deposit + fraisGestion;
  const solde = (booking.services?.price ?? 0) - deposit;

  const formatDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: deposit,
          quantity: 1,
          clientUserId: '',
          bookingMeta: {
            bookingId: booking.id,
            memberId: member.id,
            bizName: booking.biz_name,
            serviceName: booking.service_name,
            date: booking.date,
            time: booking.time,
            clientName: member.name || 'Invité',
            clientPhone: '',
            clientEmail: '',
          },
          successUrl: `${window.location.origin}/confirmation?booking=${booking.id}`,
          cancelUrl: window.location.href,
        }),
      });
      const { url, error: checkoutError } = await res.json();
      if (checkoutError) throw new Error(checkoutError);
      window.location.href = url;
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(52,211,153,0.2), rgba(52,211,153,0.06))',
              boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.25)',
            }}
          >
            <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-1">Votre place vous attend !</h1>
          <p className="text-sm text-slate-400">
            Payez vos frais de réservation pour confirmer votre créneau.
          </p>
        </div>

        {/* Booking details */}
        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/[0.06] bg-gradient-to-r from-emerald-500/5 to-transparent">
            <p className="text-xs font-bold text-emerald-400/80 uppercase tracking-widest">Récapitulatif</p>
          </div>
          <div className="px-4 py-4 space-y-2.5">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-white">{booking.service_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">chez {booking.biz_name}</p>
              </div>
              <span className="text-sm font-bold text-slate-200">{booking.services?.price ?? '?'}€</span>
            </div>
            {booking.staff_name && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Praticien</span>
                <span className="text-xs text-slate-300">{booking.staff_name}</span>
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span className="capitalize">{formatDate(booking.date)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <svg className="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {booking.time}
              </div>
            </div>
          </div>
          <div className="border-t border-dashed border-white/[0.08] mx-4" />
          <div className="px-4 py-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Frais de réservation</span>
              <span className="text-xs font-medium text-slate-300">{deposit.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Frais de gestion</span>
              <span className="text-xs font-medium text-slate-300">{fraisGestion.toFixed(2)}€</span>
            </div>
          </div>
          <div className="mx-4 border-t border-white/[0.08]" />
          <div className="px-4 py-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-white">Total à payer</span>
            <span className="text-xl font-bold text-emerald-400">{total.toFixed(2)}€</span>
          </div>
          {solde > 0 && (
            <div className="mx-4 mb-4 rounded-xl bg-slate-800/50 border border-white/[0.06] px-3 py-2.5 flex items-start gap-2">
              <span className="text-slate-500 text-sm mt-0.5">ℹ️</span>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Solde de <strong className="text-slate-400">{solde.toFixed(2)}€</strong> à régler directement sur place.
              </p>
            </div>
          )}
        </div>

        {member.name && (
          <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 px-4 py-3 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
            <p className="text-xs text-blue-300">
              Réservation pour <strong className="text-white">{member.name}</strong>
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full rounded-2xl py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50"
          style={{
            background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
            boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
            color: loading ? '#94a3b8' : '#0a1224',
          }}
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              Redirection...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
              Payer {total.toFixed(2)}€
            </>
          )}
        </button>
        <p className="mt-3 text-center text-[11px] text-slate-600 flex items-center justify-center gap-1.5">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Paiement sécurisé via Stripe
        </p>
      </div>
    </div>
  );
}
