// src/app/api/bookings/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateQrCode, isSlotPast, INVITE_EXPIRY_MS } from '@/lib/booking-utils';
import { computeStaffAvailabilityForDay, assignStaffAndCreateBooking } from '@/lib/staff-assignment';
import { createBookingWithCapacityCheck } from '@/lib/booking-capacity';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { isNonRealBusiness } from '@/lib/queries/catalog';
import type { Booking } from '@/lib/database.types';

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`bookings-create:${getClientIp(req)}`, 20, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      console.warn('[create] authData.user is null — booking will have client_id=null');
    }

    const body = await req.json();
    const { bizId, bizName, serviceId, serviceName, staffId, staffName, date, time, clientPhone, clientEmail } = body;
    // Fallback serveur : user_metadata ou email si le profil app_users n'existe pas encore
    const clientName: string =
      body.clientName ||
      (authData.user?.user_metadata as any)?.name ||
      authData.user?.email ||
      'Client';

    if (!bizId || !serviceId || !date || !time) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    // Garde-fou serveur — le front désactive déjà les créneaux passés
    // (StepDateTime.tsx), mais un state figé (onglet resté ouvert, soumission
    // tardive) ou un appel direct à l'API le contournerait sans cette
    // vérification. Seule source de vérité réelle contre la création de RDV
    // fantômes dans le passé (voir diagnostic 17/07 — faille confirmée par
    // repro directe avant ce correctif).
    if (isSlotPast(date, time)) {
      return NextResponse.json({ error: 'Ce créneau est déjà passé. Merci de choisir un autre créneau.' }, { status: 400 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('frozen, owner_id, slug')
      .eq('id', bizId)
      .maybeSingle();
    if (business?.frozen) {
      return NextResponse.json(
        { error: 'Cet établissement est temporairement indisponible.' },
        { status: 423 }
      );
    }
    // Garde-fou — 1124 fiches "démo" (isNonRealBusiness, voir
    // lib/queries/catalog.ts) sont publiées et recherchables (catalogue
    // voulu, voir supabase/seed/demo_businesses.sql) mais n'ont ni compte
    // pro ni business_settings : sans ce check, un vrai client peut
    // réserver ET payer dessus (stripe/checkout ne bloque pas l'absence de
    // compte Connect, l'argent reste sur le compte Book'nPay faute de
    // transfer_data.destination) pour un RDV qui ne sera jamais honoré.
    // Même helper que le noindex SEO — source unique de "fiche non réelle",
    // ne pas réinventer un critère owner_id divergent ici.
    if (!business || isNonRealBusiness(business)) {
      return NextResponse.json(
        { error: "Cet établissement n'est pas disponible à la réservation." },
        { status: 423 }
      );
    }

    const supabaseService = createServiceRoleClient();

    const { data: service } = await supabaseService
      .from('services')
      .select('allow_group, duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();

    // Assignation praticien — uniquement pour les services individuels
    // (allow_group === false) d'un business qui a des praticiens actifs.
    // Le pré-check JS ci-dessous ne sert qu'à (a) rejeter vite un cas déjà
    // certain sans appeler la RPC, (b) ordonner les candidats à essayer —
    // la garantie anti-race-condition vient entièrement de la fonction
    // Postgres assign_staff_and_create_booking (verrou + re-vérification +
    // insert dans une seule transaction, voir migration 0024). Un pré-check
    // périmé n'est donc jamais une faille, juste un candidat qui s'avère
    // occupé et que la RPC écarte elle-même.
    let rpcBooking: Booking | null = null;

    if (service && service.allow_group === false) {
      const staffAvailability = await computeStaffAvailabilityForDay(
        supabaseService,
        bizId,
        date,
        service.duration_minutes
      );

      if (staffAvailability) {
        const freeStaffIds = staffAvailability.availability[time]?.freeStaffIds ?? [];
        const allStaffIds = staffAvailability.staffRows.map((s) => s.id);

        let candidateStaffIds: string[];
        if (staffId) {
          // Praticien choisi explicitement : pas de substitution automatique
          // s'il s'avère occupé, on respecte le choix du client (comme avant).
          if (!freeStaffIds.includes(staffId)) {
            return NextResponse.json(
              { error: 'Ce praticien vient d\'être réservé pour ce créneau. Merci de choisir un autre créneau ou praticien.' },
              { status: 409 }
            );
          }
          candidateStaffIds = [staffId];
        } else {
          if (freeStaffIds.length === 0) {
            return NextResponse.json(
              { error: 'Aucun praticien disponible pour ce créneau. Merci de choisir un autre créneau.' },
              { status: 409 }
            );
          }
          // Candidats "vus libres" par le pré-check en premier, puis le reste
          // du staff actif en secours (ex: une annulation concurrente vient
          // de libérer quelqu'un entre le pré-check et l'appel RPC).
          candidateStaffIds = [
            ...freeStaffIds,
            ...allStaffIds.filter((id) => !freeStaffIds.includes(id)),
          ];
        }

        rpcBooking = await assignStaffAndCreateBooking(supabaseService, {
          bizId,
          bizName,
          serviceId,
          serviceName,
          date,
          time,
          durationMinutes: service.duration_minutes,
          candidateStaffIds,
          clientId: authData.user?.id || null,
          clientPhone: clientPhone || null,
          clientName,
          clientEmail: clientEmail || null,
        });

        if (!rpcBooking) {
          // Tous les candidats se sont avérés occupés sous verrou (pré-check
          // périmé) — même messages que le fast-path ci-dessus, selon le cas.
          return NextResponse.json(
            {
              error: staffId
                ? 'Ce praticien vient d\'être réservé pour ce créneau. Merci de choisir un autre créneau ou praticien.'
                : 'Aucun praticien disponible pour ce créneau. Merci de choisir un autre créneau.',
            },
            { status: 409 }
          );
        }
      }
    }

    // Upsert app_users pour les comptes existants créés avant le fix du trigger
    if (authData.user?.id) {
      await supabaseService.from('app_users').upsert({
        id: authData.user.id,
        name: clientName,
        phone: clientPhone || null,
        role: 'client',
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    let booking: Booking;
    if (rpcBooking) {
      // Déjà inséré par assign_staff_and_create_booking (RETURNING *).
      booking = rpcBooking;
    } else {
      // Service collectif, ou business sans staff actif — passe par la RPC
      // anti-surbooking (migration 0026) : verrou + re-vérification de
      // services.max_persons + insertion dans une seule transaction Postgres.
      const capacityBooking = await createBookingWithCapacityCheck(supabaseService, {
        bizId,
        bizName,
        serviceId,
        serviceName,
        staffId: staffId || null,
        staffName: staffName || null,
        date,
        time,
        clientId: authData.user?.id || null,
        clientPhone: clientPhone || null,
        clientName,
        clientEmail: clientEmail || null,
      });

      if (!capacityBooking) {
        return NextResponse.json(
          { error: 'Ce créneau vient d\'atteindre sa capacité maximale. Merci de choisir un autre créneau.' },
          { status: 409 }
        );
      }
      booking = capacityBooking;
    }

    // Nom du parrain (si le client a été parrainé) — dénormalisé pour le pro
    let referrerName: string | null = null;
    if (authData.user?.id) {
      const { data: clientProfile } = await supabaseService
        .from('app_users')
        .select('referred_by')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (clientProfile?.referred_by) {
        const { data: referrer } = await supabaseService
          .from('app_users')
          .select('name')
          .eq('id', clientProfile.referred_by)
          .maybeSingle();
        referrerName = referrer?.name || null;
      }
    }

    const { data: member, error: memberError } = await supabaseService
      .from('booking_members')
      .insert({
        booking_id: booking.id,
        name: clientName,
        phone: clientPhone,
        status: 'invite',
        qr_code: generateQrCode(),
        referrer_name: referrerName,
        // Sans ça, un abandon du tunnel Stripe (avant checkout.session.completed)
        // laissait ce membre 'invite' à vie — rien ne le clôturait jamais (voir
        // diagnostic 17/07). Filet lu par cleanup-expired-invites ; la voie
        // rapide normale est le webhook checkout.session.expired.
        invite_expiry: new Date(Date.now() + INVITE_EXPIRY_MS).toISOString(),
      })
      .select()
      .single();

    if (memberError) throw memberError;

    return NextResponse.json({ booking, member });
  } catch (error: any) {
    return logAndRespond('[CreateBooking] Erreur:', error);
  }
}
