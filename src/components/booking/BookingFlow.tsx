'use client';
// src/components/booking/BookingFlow.tsx
// Port de src/pages/BookingFlow.jsx — orchestrateur du parcours en 3 étapes
// (service → date/heure → paiement), avec mur d'authentification interstitiel.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/client';
import StepDots from './StepDots';
import StepService from './StepService';
import StepDateTime from './StepDateTime';
import StepPayment from './StepPayment';
import AuthWall from './AuthWall';

export default function BookingFlow({
  business,
  icon,
}: {
  business: BusinessWithDetails;
  icon: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [service, setService] = useState<Service | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [participants, setParticipants] = useState(1);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
  }, []);

  const handleServiceSelect = (srv: Service, stf: Staff | null) => {
    setService(srv);
    setStaff(stf);
    setStep(1);
  };

  const handleDateTimeSelect = (d: string, t: string, p: number) => {
    setDate(d);
    setTime(t);
    setParticipants(p);
    if (!isAuthed) {
      setNeedsAuth(true);
    } else {
      setStep(2);
    }
  };

  const handleAuth = () => {
    setIsAuthed(true);
    setNeedsAuth(false);
    setStep(2);
  };

  const goBack = () => {
    if (needsAuth) {
      setNeedsAuth(false);
      return;
    }
    if (step > 0) setStep(step - 1);
    else router.push('/recherche');
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <button onClick={goBack} className="rounded-lg p-1.5 hover:bg-white/10 transition-colors">
            ←
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg">
            {icon}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">{business.name}</h1>
            <p className="text-xs text-white/50">
              {business.city} · {business.type}
            </p>
          </div>
        </div>

        <StepDots current={needsAuth ? 1 : step} />

        {needsAuth ? (
          <div>
            <h2 className="mb-3 text-center text-lg font-semibold text-white">Identification</h2>
            {date && time && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-4 py-3">
                <span className="text-lg">🔒</span>
                <p className="text-xs leading-snug text-emerald-400">
                  Votre créneau du <strong>{date} à {time}</strong> pour{' '}
                  <strong>{service?.name}</strong> vous attend. Identifiez-vous pour le confirmer.
                </p>
              </div>
            )}
            <AuthWall onAuth={handleAuth} />
          </div>
        ) : (
          <div>
            {step === 0 && (
              <>
                <h2 className="mb-4 text-lg font-semibold text-white">Choisir une prestation</h2>
                <StepService business={business} onSelect={handleServiceSelect} />
              </>
            )}
            {step === 1 && service && (
              <>
                <h2 className="mb-4 text-lg font-semibold text-white">Date et Heure</h2>
                <StepDateTime business={business} service={service} onSelect={handleDateTimeSelect} />
              </>
            )}
            {step === 2 && service && date && time && (
              <>
                <h2 className="mb-4 text-lg font-semibold text-white">Paiement</h2>
                <StepPayment
                  business={business}
                  service={service}
                  staff={staff}
                  date={date}
                  time={time}
                  participants={participants}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
