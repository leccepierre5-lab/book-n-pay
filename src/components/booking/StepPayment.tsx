'use client';
// src/components/booking/StepPayment.tsx
// Port de src/components/booking/StepPayment.jsx
// Crée le booking en base, puis redirige vers Stripe Checkout pour le
// paiement des frais de réservation + frais de gestion.
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
      <div className="mb-5 space-y-3 rounded-xl bg-navy-900 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-white/60">{service.name}</span>
          <span className="text-white">{service.price}€</span>
        </div>
        {staff && (
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Praticien</span>
            <span className="text-white">{staff.name}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-white/60">Date</span>
          <span className="text-white">{date} à {time}</span>
        </div>
        <hr className="border-white/10" />
        <div className="flex justify-between text-sm">
          <span className="text-white/60">Frais de réservation</span>
          <span className="text-white">{service.deposit.toFixed(2)}€</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-white/60">Frais de gestion</span>
          <span className="text-white">{fraisGestion.toFixed(2)}€</span>
        </div>
        <div className="flex justify-between text-sm font-semibold">
          <span className="text-white">Total à payer maintenant</span>
          <span className="text-mint-400">{total.toFixed(2)}€</span>
        </div>
        <p className="text-xs text-white/40">
          Le solde ({(service.price - service.deposit).toFixed(2)}€) sera réglé sur place.
        </p>
      </div>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full rounded-xl bg-mint-500 py-3 font-medium text-navy-950 disabled:opacity-50"
      >
        {loading ? 'Redirection...' : `Payer ${total.toFixed(2)}€`}
      </button>
    </div>
  );
}
