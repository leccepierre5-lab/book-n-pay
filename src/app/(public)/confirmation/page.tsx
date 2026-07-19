import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import ShareGroupLink from '@/components/group/ShareGroupLink';
import ShareGuestLinks from '@/components/group/ShareGuestLinks';

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{
    booking?: string; mode?: string; guests?: string;
    demo?: string; biz?: string; service?: string; date?: string; time?: string; slots?: string; participants?: string; staff?: string;
  }>;
}) {
  const {
    booking: bookingId, mode, guests: guestsParam,
    demo, biz, service, date: demoDate, time: demoTime, slots: demoSlots, participants: demoParticipants, staff: demoStaff,
  } = await searchParams;
  const isDemo = demo === '1';
  const supabase = await createClient();

  const { data: booking } = bookingId
    ? await supabase.from('bookings').select('*, services(max_persons)').eq('id', bookingId).maybeSingle()
    : { data: null };

  const isGroupBooking =
    (booking as any)?.services?.max_persons && (booking as any).services.max_persons > 1;

  // Récap groupe (participants + praticien assigné) : group_ref ne sert JAMAIS
  // de clé d'accès — il n'est lu que si `booking` (déjà chargé sous RLS ci-
  // dessus) prouve que l'utilisateur courant EST l'organisateur de ce booking
  // précis (client_id = son propre auth.uid()). Un pro/admin qui pourrait par
  // ailleurs lire cette ligne via RLS (owns_biz/is_admin) ne matche pas ce
  // filtre et ne déclenche donc aucun élargissement. Voir mémoire pitfall #35.
  const { data: { user } } = await supabase.auth.getUser();
  const isProvenOrganizer =
    !!user && !!(booking as any)?.group_ref && (booking as any).client_id === user.id;

  const { data: groupParticipants } = isProvenOrganizer
    ? await createServiceRoleClient()
        .from('bookings')
        .select('id, client_name, staff_name, status')
        .eq('group_ref', (booking as any).group_ref)
        .neq('status', 'cancelled')
        .order('time', { ascending: true })
    : { data: null };

  const isModeB = mode === 'b' && !!guestsParam;
  const guestMemberIds = isModeB
    ? guestsParam!.split(',').filter(Boolean)
    : [];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  };

  // Mode démo : bookings/create[-group] n'a rien écrit en base (fiche sans
  // propriétaire réel, voir ces fichiers) — le récap vient entièrement des
  // query params posés par StepPayment.tsx, jamais d'une lecture DB.
  const demoSlotsList = demoSlots ? demoSlots.split(',').filter(Boolean) : [];

  return (
    <div className="relative flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(52,211,153,0.07)_0%,transparent_65%)] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Success icon */}
        <div className="flex justify-center mb-6">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(52,211,153,0.2), rgba(52,211,153,0.08))',
              boxShadow: '0 0 48px rgba(52,211,153,0.25), inset 0 0 0 1px rgba(52,211,153,0.25)',
            }}
          >
            <svg className="w-10 h-10 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">
            {isDemo ? 'Paiement test réussi !' : 'Réservation confirmée !'}
          </h1>
          {isDemo ? (
            <p className="text-slate-400 text-sm leading-relaxed">
              <span className="font-medium text-slate-200">{service}</span>
              {biz && <><span className="text-slate-500"> chez </span><span className="font-medium text-slate-200">{biz}</span></>}
              {demoDate && (
                <>
                  <br />
                  <span className="text-slate-500">le </span>
                  <span className="text-mint-400 font-medium">{formatDate(demoDate)}</span>
                </>
              )}
              {demoTime && (
                <>
                  <span className="text-slate-500"> à </span>
                  <span className="text-mint-400 font-medium">{demoTime}</span>
                </>
              )}
              {demoSlotsList.length > 0 && (
                <>
                  <span className="text-slate-500"> — </span>
                  <span className="text-mint-400 font-medium">{demoSlotsList.join(' → ')}</span>
                  {demoParticipants && <span className="text-slate-500"> ({demoParticipants} personnes)</span>}
                </>
              )}
              {demoStaff && (
                <>
                  <br />
                  <span className="text-slate-500">avec </span>
                  <span className="text-slate-300 font-medium">{demoStaff}</span>
                </>
              )}
            </p>
          ) : booking ? (
            <p className="text-slate-400 text-sm leading-relaxed">
              <span className="font-medium text-slate-200">{booking.service_name}</span>
              <span className="text-slate-500"> chez </span>
              <span className="font-medium text-slate-200">{booking.biz_name}</span>
              <br />
              <span className="text-slate-500">le </span>
              <span className="text-mint-400 font-medium">{formatDate(booking.date)}</span>
              <span className="text-slate-500"> à </span>
              <span className="text-mint-400 font-medium">{booking.time}</span>
              {booking.staff_name && (
                <>
                  <br />
                  <span className="text-slate-500">avec </span>
                  <span className="text-slate-300 font-medium">{booking.staff_name}</span>
                </>
              )}
            </p>
          ) : (
            <p className="text-slate-400 text-sm leading-relaxed">
              Votre réservation a été enregistrée.<br />
              Un email de confirmation vous a été envoyé.
            </p>
          )}
        </div>

        {isDemo && (
          <div className="mb-5 rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4">
            <p className="text-xs font-semibold text-amber-300 mb-1">🧪 Mode démo</p>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              Paiement effectué avec une carte de test Stripe, zéro euro réel déplacé.
              Aucune réservation n&apos;a été enregistrée et aucun email n&apos;a été envoyé —
              cette fiche n&apos;a pas de compte pro actif derrière elle.
            </p>
          </div>
        )}

        {/* Récap groupe — participants + praticien, organisateur uniquement */}
        {isProvenOrganizer && groupParticipants && groupParticipants.length > 0 && (
          <div className="mb-5 rounded-2xl bg-navy-900 border border-white/[0.08] p-4">
            <p className="text-xs font-semibold text-slate-200 mb-2.5">Votre groupe</p>
            <div className="space-y-1.5">
              {groupParticipants.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300 truncate">
                    {p.client_name || 'Invité'}
                    {p.id === bookingId && <span className="text-slate-600 font-normal"> (vous)</span>}
                  </span>
                  {p.staff_name && (
                    <span className="text-slate-500 shrink-0">avec {p.staff_name}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Email reminder — absent en mode démo, aucun email n'est réellement envoyé */}
        {!isDemo && (
          <div className="mb-5 rounded-2xl bg-navy-900 border border-white/[0.08] p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Email de confirmation envoyé</p>
              <p className="text-xs text-slate-500 mt-0.5">Vérifiez votre boîte mail (et vos spams)</p>
            </div>
          </div>
        )}

        {/* Mode B: share individual payment links */}
        {isModeB && guestMemberIds.length > 0 && (
          <ShareGuestLinks guestMemberIds={guestMemberIds} />
        )}

        {/* Old-style group join link (for rejoindre flow) */}
        {!isModeB && isGroupBooking && bookingId && (
          <div className="mb-5">
            <ShareGroupLink bookingId={bookingId} />
          </div>
        )}

        <Link
          href={isDemo ? '/recherche' : '/mes-reservations'}
          className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
            boxShadow: '0 4px 24px rgba(52,211,153,0.4)',
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          {isDemo ? 'Essayer une autre fiche' : 'Voir mes réservations'}
        </Link>

        <Link href="/recherche" className="block text-center mt-3 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          Réserver un autre créneau →
        </Link>
      </div>
    </div>
  );
}
