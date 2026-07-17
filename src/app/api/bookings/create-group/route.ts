import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateQrCode, generateGroupRef, normalizePhone, isSlotPast } from '@/lib/booking-utils';
import { createBookingWithCapacityCheck } from '@/lib/booking-capacity';
import { assignStaffAndCreateBooking } from '@/lib/staff-assignment';
import { normalizeStaffChoice, orderExplicitFirst, getCandidateStaffIds } from '@/lib/staff-group-order';
import { logAndRespond } from '@/lib/api-error';
import { isNonRealBusiness } from '@/lib/queries/catalog';
import type { Booking } from '@/lib/database.types';

interface ParticipantMeta {
  index: number;
  isOrganizer: boolean;
  participantName: string;
  participantPhone: string | null;
  participantEmail: string | null;
  slot: string;
  staffChoice: string | null; // null = "peu importe"
}

export async function POST(req: NextRequest) {
  // Hissés hors du try : le catch a besoin d'y accéder pour le rollback
  // applicatif des insertions partielles (pas de transaction SQL possible
  // via PostgREST, chaque .insert() est un appel séparé).
  const supabaseService = createServiceRoleClient();
  const createdBookingIds: string[] = [];
  const createdMemberIds: string[] = [];

  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      console.warn('[create-group] authData.user is null — booking will have client_id=null');
    }

    const body = await req.json();
    const {
      bizId, bizName, serviceId, serviceName, staffId, staffName,
      date, slots, mode, clientName, clientPhone, clientEmail,
      guestNames = [],   // Mode A: optional participant names
      guests = [],       // Mode B: [{ name?, phone }] for each invited guest
    } = body;

    if (!bizId || !serviceId || !date || !Array.isArray(slots) || slots.length < 2) {
      return NextResponse.json({ error: 'Champs requis manquants (slots min 2)' }, { status: 400 });
    }
    if (slots.length > 23) {
      return NextResponse.json({ error: 'Groupe limité à 23 personnes maximum' }, { status: 400 });
    }
    if (mode === 'b' && guests.length !== slots.length - 1) {
      return NextResponse.json({ error: 'Nombre d\'invités incorrect pour le mode B' }, { status: 400 });
    }
    // Même garde-fou que bookings/create/route.ts — un groupe peut couvrir
    // plusieurs créneaux consécutifs (ex. 09h30 → 11h00), il suffit qu'UN
    // seul soit déjà passé pour rejeter toute la création.
    if (slots.some((s: string) => isSlotPast(date, s))) {
      return NextResponse.json({ error: 'Un ou plusieurs créneaux sont déjà passés. Merci de choisir un autre horaire.' }, { status: 400 });
    }
    // staffChoices : un choix par personne pour le cas "service individuel
    // multi-praticiens" (CAS 2 — voir CONCEPTION_CAS2_STAFF_GROUPE.md).
    // Optionnel et rétrocompatible : absent → tout le monde hérite du staffId
    // unique envoyé aujourd'hui par le front (ou null = "peu importe" pour
    // tous), comportement inchangé pour les appelants qui ne l'envoient pas
    // encore (étape front pas encore livrée).
    if (body.staffChoices !== undefined) {
      if (!Array.isArray(body.staffChoices) || body.staffChoices.length !== slots.length) {
        return NextResponse.json({ error: 'staffChoices doit avoir une entrée par personne' }, { status: 400 });
      }
    }
    const staffChoicesRaw: (string | null)[] = Array.isArray(body.staffChoices)
      ? body.staffChoices
      : slots.map(() => staffId || null);

    // Check biz not frozen
    const { data: biz } = await supabaseService
      .from('businesses')
      .select('frozen, owner_id, slug')
      .eq('id', bizId)
      .maybeSingle();
    if (biz?.frozen) {
      return NextResponse.json({ error: 'Établissement temporairement indisponible.' }, { status: 423 });
    }
    // Même garde-fou que bookings/create/route.ts (isNonRealBusiness, source
    // unique partagée avec le noindex SEO) — voir ce fichier pour le
    // raisonnement complet (fiches démo réservables ET payables).
    if (!biz || isNonRealBusiness(biz)) {
      return NextResponse.json({ error: "Cet établissement n'est pas disponible à la réservation." }, { status: 423 });
    }

    // Upsert organizer profile
    if (authData.user?.id) {
      await supabaseService.from('app_users').upsert({
        id: authData.user.id,
        name: clientName,
        phone: clientPhone || null,
        role: 'client',
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    // Referrer name for organizer (denormalized for pro dashboard)
    let referrerName: string | null = null;
    if (authData.user?.id) {
      const { data: profile } = await supabaseService
        .from('app_users')
        .select('referred_by')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profile?.referred_by) {
        const { data: referrer } = await supabaseService
          .from('app_users')
          .select('name')
          .eq('id', profile.referred_by)
          .maybeSingle();
        referrerName = referrer?.name || null;
      }
    }

    const groupRef = generateGroupRef();
    // ⚠️ 20 min ici, PAS INVITE_EXPIRY_MS (30 min, booking-utils.ts) —
    // divergence VOLONTAIRE, pas un oubli d'harmonisation. payment_deadline
    // régit un groupe créé d'un coup (organisateur + invités déjà connus,
    // mode A/B) et est lu par le cron expire-groups + le polling lazy
    // group/pending-status (voir lib/group/expireGroup.ts) ; INVITE_EXPIRY_MS
    // régit une invitation individuelle (solo, ou rejoindre-par-lien) et est
    // lu par cleanup-expired-invites. Deux mécanismes, deux flux distincts,
    // déjà testés séparément (CAS 2, 14/14 PASS) — ne pas aligner sans
    // revalider tout le parcours groupe.
    const paymentDeadline = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    const participantsMeta: ParticipantMeta[] = slots.map((slot: string, i: number) => {
      const isOrganizer = i === 0;
      const guestIdx = i - 1;
      const participantName = isOrganizer
        ? clientName
        : (mode === 'a'
            ? (guestNames[i] || `Personne ${i + 1}`)
            : (guests[guestIdx]?.name || `Invité ${i}`));
      const participantPhone = isOrganizer
        ? (clientPhone || null)
        : (mode === 'b' ? normalizePhone(guests[guestIdx]?.phone || '') : null);
      return {
        index: i,
        isOrganizer,
        participantName,
        participantPhone,
        participantEmail: isOrganizer ? (clientEmail || null) : null,
        slot,
        staffChoice: staffChoicesRaw[i] ?? null,
      };
    });

    const { data: service } = await supabaseService
      .from('services')
      .select('allow_group, duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();

    let staffRows: { id: string; name: string }[] = [];
    if (service && service.allow_group === false) {
      const { data } = await supabaseService
        .from('staff')
        .select('id, name')
        .eq('biz_id', bizId)
        .eq('is_active', true);
      staffRows = data || [];
    }

    // CAS 2 : service individuel avec au moins un praticien actif — passe par
    // assign_staff_and_create_booking (0024) en boucle, une fois par
    // personne, avec exclusion cumulative des praticiens déjà assignés dans
    // CE groupe. Choix précis d'abord (pour ne pas se faire voler leur
    // praticien par une auto-assignation "peu importe" traitée avant eux),
    // "peu importe" ensuite avec les praticiens restants. Voir
    // CONCEPTION_CAS2_STAFF_GROUPE.md pour le raisonnement complet
    // (atomicité par praticien garantie par le verrou de 0024, atomicité du
    // groupe entier par le rollback applicatif ci-dessous, comme pour la
    // branche capacité).
    const useStaffAssignment = !!service && service.allow_group === false && staffRows.length > 0;

    const resultsByIndex = new Map<number, { bookingId: string; memberId: string }>();

    if (useStaffAssignment) {
      // Staff id invalide/périmé (désactivé entre le chargement de la page et
      // la soumission) : dégradé silencieusement en "peu importe" plutôt que
      // de faire échouer tout le groupe pour une donnée cliente simplement
      // obsolète.
      const validStaffIds = new Set(staffRows.map((s) => s.id));
      const normalized = participantsMeta.map((p) => ({
        ...p,
        staffChoice: normalizeStaffChoice(p.staffChoice, validStaffIds),
      }));

      const assignedStaffIds = new Set<string>();
      const allStaffIds = staffRows.map((s) => s.id);

      for (const p of orderExplicitFirst(normalized)) {
        const candidateStaffIds = getCandidateStaffIds(p.staffChoice, allStaffIds, assignedStaffIds);

        let assigned: Booking | null;
        try {
          assigned = await assignStaffAndCreateBooking(supabaseService, {
            bizId,
            bizName,
            serviceId,
            serviceName,
            date,
            time: p.slot,
            durationMinutes: service!.duration_minutes,
            candidateStaffIds,
            clientId: p.isOrganizer ? (authData.user?.id || null) : null,
            clientPhone: p.participantPhone,
            clientName: p.participantName,
            clientEmail: p.participantEmail,
            groupRef,
            paymentDeadline,
          });
        } catch (err: any) {
          // 23505 (bookings_staff_slot_unique, migration 0023) : ne devrait
          // structurellement jamais se produire ici (le verrou de 0024 porte
          // sur toute la journée du praticien et est acquis avant toute
          // relecture, donc les appels qui partagent un candidat sont déjà
          // sérialisés) — traité par prudence comme "candidat indisponible",
          // sans retry sur le candidat suivant (voir CONCEPTION_CAS2_STAFF_GROUPE.md :
          // parser le detail Postgres pour cibler le bon candidat serait fragile
          // pour un cas qui ne devrait pas survenir en usage normal).
          if (err?.code === '23505') {
            assigned = null;
          } else {
            throw err;
          }
        }

        if (!assigned) {
          throw Object.assign(
            new Error(
              p.staffChoice
                ? `Le praticien choisi pour ${p.participantName} vient d'être réservé sur ce créneau. Merci de réessayer.`
                : `Plus assez de praticiens disponibles à ${p.slot} pour tout le groupe. Merci de réessayer.`
            ),
            { isSlotConflict: true }
          );
        }

        createdBookingIds.push(assigned.id);
        assignedStaffIds.add(assigned.staff_id!);

        const { data: member, error: memberError } = await supabaseService
          .from('booking_members')
          .insert({
            booking_id: assigned.id,
            name: p.participantName,
            phone: p.participantPhone,
            status: 'invite',
            qr_code: generateQrCode(),
            referrer_name: p.isOrganizer ? referrerName : null,
          })
          .select('id')
          .single();
        if (memberError) throw memberError;
        createdMemberIds.push(member.id);

        resultsByIndex.set(p.index, { bookingId: assigned.id, memberId: member.id });
      }
    } else {
      // Service collectif, ou business sans staff actif — chemin inchangé :
      // RPC anti-surbooking (0026), staff partagé pour tout le groupe (ex.
      // un instructeur de cours).
      for (const p of participantsMeta) {
        let booking: { id: string };
        try {
          const rpcBooking = await createBookingWithCapacityCheck(supabaseService, {
            bizId,
            bizName,
            serviceId,
            serviceName,
            staffId: staffId || null,
            staffName: staffName || null,
            date,
            time: p.slot,
            clientId: p.isOrganizer ? (authData.user?.id || null) : null,
            clientPhone: p.participantPhone,
            clientName: p.participantName,
            clientEmail: p.participantEmail,
            groupRef,
            paymentDeadline,
          });

          if (!rpcBooking) {
            throw Object.assign(
              new Error(`Le créneau ${p.slot} vient d'atteindre sa capacité maximale. Merci de réessayer.`),
              { isSlotConflict: true }
            );
          }
          booking = rpcBooking;
        } catch (err: any) {
          if (err?.isSlotConflict) throw err;
          // Violation de bookings_staff_slot_unique (migration 0023) — collision
          // réelle sur ce praticien/créneau, pas une erreur inattendue.
          if (err?.code === '23505') {
            throw Object.assign(
              new Error(`Le créneau ${p.slot} n'est plus disponible pour ce praticien. Merci de réessayer.`),
              { isSlotConflict: true }
            );
          }
          throw err;
        }

        createdBookingIds.push(booking.id);

        const { data: member, error: memberError } = await supabaseService
          .from('booking_members')
          .insert({
            booking_id: booking.id,
            name: p.participantName,
            phone: p.participantPhone,
            status: 'invite',
            qr_code: generateQrCode(),
            referrer_name: p.isOrganizer ? referrerName : null,
          })
          .select('id')
          .single();

        if (memberError) throw memberError;
        createdMemberIds.push(member.id);

        resultsByIndex.set(p.index, { bookingId: booking.id, memberId: member.id });
      }
    }

    // Réassemble dans l'ordre ORIGINAL des participants (pas l'ordre de
    // traitement "précis d'abord" de la branche staff) — created[0] doit
    // rester l'organisateur.
    const created = participantsMeta.map((p) => ({
      bookingId: resultsByIndex.get(p.index)!.bookingId,
      memberId: resultsByIndex.get(p.index)!.memberId,
      isOrganizer: p.isOrganizer,
    }));

    const organizer = created[0];
    const guestData = created.slice(1);

    return NextResponse.json({
      groupRef,
      primaryBookingId: organizer.bookingId,
      primaryMemberId: organizer.memberId,
      allMemberIds: created.map((c) => c.memberId),
      guestMemberIds: guestData.map((c) => c.memberId),
    });
  } catch (error: any) {
    // Rollback des insertions partielles de cette requête. Isolé dans son
    // propre try/catch : un échec du rollback (ex. nouvelle erreur réseau)
    // ne doit jamais remplacer la réponse d'erreur d'origine renvoyée au
    // client — loggé séparément avec les IDs orphelins pour investigation
    // manuelle, la réponse ci-dessous part quoi qu'il arrive.
    if (createdMemberIds.length > 0 || createdBookingIds.length > 0) {
      try {
        if (createdMemberIds.length > 0) {
          const { error: delMemberErr } = await supabaseService
            .from('booking_members')
            .delete()
            .in('id', createdMemberIds);
          if (delMemberErr) throw delMemberErr;
        }
        if (createdBookingIds.length > 0) {
          const { error: delBookingErr } = await supabaseService
            .from('bookings')
            .delete()
            .in('id', createdBookingIds);
          if (delBookingErr) throw delBookingErr;
        }
      } catch (rollbackError) {
        console.error(
          '[CreateGroup] Échec du rollback — lignes orphelines à nettoyer manuellement:',
          { createdBookingIds, createdMemberIds, rollbackError }
        );
      }
    }

    if (error?.isSlotConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return logAndRespond('[CreateGroup] Erreur:', error);
  }
}
