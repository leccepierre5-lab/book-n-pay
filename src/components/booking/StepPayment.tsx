'use client';
import { useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';
import { calcFraisGestion } from '@/lib/booking-utils';
import { createClient } from '@/lib/supabase/client';

export default function StepPayment({
  business,
  service,
  staff,
  date,
  time,
  participants,
}: {
  business: BusinessWithDetails;
  service: Service;
  staff: Staff | null;
  date: string;
  time: string;
  participants: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fraisGestion = calcFraisGestion(service.price);
  const total = service.deposit + fraisGestion;
  const solde = service.price - service.deposit;

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('app_users')
        .select('name, phone')
        .eq('id', authData.user?.id)
        .maybeSingle();

      const createRes = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizId: business.id,
          bizName: business.name,
          serviceId: service.id,
          serviceName: service.name,
          staffId: staff?.id,
          staffName: staff?.name,
          date,
          time,
          clientName: profile?.name,
          clientPhone: profile?.phone,
          clientEmail: authData.user?.email,
        }),
      });
      const { booking, member, error: createError } = await createRes.json();
      if (createError) throw new Error(createError);

      const checkoutRes = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: service.deposit,
          groupSize: participants,
          bookingMeta: {
            bookingId: booking.id,
            memberId: member.id,
            bizId: business.id,
            bizName: business.name,
            serviceName: service.name,
            date,
            time,
            clientName: profile?.name,
            clientPhone: profile?.phone,
            clientEmail: authData.user?.email,
          },
          successUrl: `${window.location.origin}/confirmation?booking=${booking.id}`,
          cancelUrl: window.location.href,
        }),
      });
      const { url, error: checkoutError } = await checkoutRes.json();
      if (checkoutError) throw new Error(checkoutError);

      window.location.href = url;
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Receipt card */}
      <div className="rounded-2xl bg-navy-900 border border-white/[0.08] overflow-hidden mb-4">
        {/* Receipt header */}
        <div className="px-4 py-3.5 border-b border-white/[0.06] bg-gradient-to-r from-mint-500/5 to-transparent">
          <p className="text-xs font-bold text-mint-400/80 uppercase tracking-widest">Récapitulatif</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-white">{service.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">chez {business.name}</p>
            </div>
            <span className="text-sm font-bold text-slate-200">{service.price}€</span>
          </div>

          {staff && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Praticien</span>
              <span className="text-xs text-slate-300">{staff.emoji} {staff.name}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {date}
            </span>
            <span className="text-xs text-slate-300 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {time}
            </span>
          </div>
        </div>

        <div className="border-t border-dashed border-white/[0.08] mx-4" />

        <div className="px-4 py-4 space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Frais de réservation</span>
            <span className="text-xs font-medium text-slate-300">{service.deposit.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Frais de gestion</span>
            <span className="text-xs font-medium text-slate-300">{fraisGestion.toFixed(2)}€</span>
          </div>
        </div>

        <div className="mx-4 border-t border-white/[0.08]" />

        <div className="px-4 py-4 flex justify-between items-center">
          <span className="text-sm font-semibold text-white">Total maintenant</span>
          <span className="text-lg font-bold text-mint-400">{total.toFixed(2)}€</span>
        </div>

        {solde > 0 && (
          <div className="mx-4 mb-4 rounded-xl bg-slate-800/50 border border-white/[0.06] px-3 py-2.5 flex items-start gap-2">
            <span className="text-slate-500 text-sm mt-0.5">ℹ️</span>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Solde de <strong className="text-slate-400">{solde.toFixed(2)}€</strong> à régler directement sur place le jour du RDV.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
        }}
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Redirection en cours...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
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
  );
}
