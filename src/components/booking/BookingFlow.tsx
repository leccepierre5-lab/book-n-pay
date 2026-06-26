'use client';
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
  const [slots, setSlots] = useState<string[]>([]);   // one per participant
  const [participants, setParticipants] = useState(1);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleServiceSelect = (srv: Service, stf: Staff | null) => {
    setService(srv);
    setStaff(stf);
    setStep(1);
  };

  const handleDateTimeSelect = async (d: string, s: string[], p: number) => {
    setDate(d);
    setSlots(s);
    setParticipants(p);
    const { data } = await createClient().auth.getSession();
    if (data.session) {
      setIsAuthed(true);
      setStep(2);
    } else {
      setNeedsAuth(true);
    }
  };

  const handleAuth = () => {
    setIsAuthed(true);
    setNeedsAuth(false);
    setStep(2);
  };

  const goBack = () => {
    if (needsAuth) { setNeedsAuth(false); return; }
    if (step > 0) setStep(step - 1);
    else router.push('/recherche');
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-6">

        {/* Business header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={goBack}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] hover:bg-white/10 transition-all duration-200 text-slate-400 hover:text-white shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/[0.08] text-lg shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white truncate">{business.name}</h1>
            <p className="text-xs text-slate-500 truncate">{business.city} · {business.type}</p>
          </div>
        </div>

        <StepDots current={needsAuth ? 1 : step} />

        {needsAuth ? (
          <div>
            <h2 className="mb-4 text-center text-lg font-semibold text-white">Identification</h2>
            {date && slots.length > 0 && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-600/25 bg-emerald-600/8 px-4 py-3.5">
                <span className="text-lg shrink-0 mt-0.5">🔒</span>
                <p className="text-xs leading-relaxed text-emerald-400">
                  Votre créneau <strong>{date} à {slots[0]}</strong> pour{' '}
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
                <h2 className="mb-4 text-base font-semibold text-white">Choisir une prestation</h2>
                <StepService business={business} onSelect={handleServiceSelect} />
              </>
            )}
            {step === 1 && service && (
              <>
                <h2 className="mb-4 text-base font-semibold text-white">Date et Heure</h2>
                <StepDateTime business={business} service={service} onSelect={handleDateTimeSelect} />
              </>
            )}
            {step === 2 && service && date && slots.length > 0 && (
              <>
                <h2 className="mb-4 text-base font-semibold text-white">Paiement</h2>
                <StepPayment
                  business={business}
                  service={service}
                  staff={staff}
                  date={date}
                  slots={slots}
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
