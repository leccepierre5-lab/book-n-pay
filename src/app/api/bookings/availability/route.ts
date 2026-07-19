// src/app/api/bookings/availability/route.ts
// Renvoie le nombre de personnes déjà inscrites par créneau pour un biz/date
// donné — équivalent de guestsAtSlot() mais calculé côté serveur avec des
// données fraîches (pas de risque de désync avec un state client périmé).
//
// `counts` (occupation par tête) :
// - Pour un service collectif (allow_group === true) : isolée par
//   `(service_id, staff_id)` — clé `"HH:MM::<staffId ou vide>"`. Corrige un
//   bug où deux services collectifs différents au même horaire (ex. Yoga et
//   Pilates à 10h00) se polluaient mutuellement (voir
//   CONCEPTION_GROUPE_ASSIGNATION.md, bug n°1). `staff_id` est inclus dans la
//   clé : si un business a plusieurs instructeurs actifs donnant le même
//   `service_id` en parallèle, ce sont bien deux séances distinctes avec
//   chacune sa propre capacité — fusionner leurs comptes serait le même bug.
//   `staff_id` NULL (aucun praticien assigné) regroupe les réservations sans
//   praticien ensemble, ce qui reste correct : rien dans l'interface actuelle
//   ne permet de distinguer deux séances concurrentes sans praticien assigné.
// - Pour tout le reste (pas de serviceId, ou service individuel sans staff
//   configuré, fallback) : clé `HH:MM` seule, comportement 100% inchangé —
//   partagé tous services confondus (voir CONCEPTION_GROUPE_ASSIGNATION.md
//   pour la justification de ne pas toucher ce chemin ici).
//
// `staffAvailability` est un champ additif, calculé uniquement si `serviceId`
// est fourni, que le service est individuel (allow_group === false) ET que
// le business a au moins un praticien actif dans `staff`. Consommé par
// StepDateTime.tsx pour griser les créneaux par praticien plutôt que par
// tête. Absence de serviceId, ou business sans staff = comportement
// 100% identique à avant (counts).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeStaffAvailabilityForDay, computeSoloAvailabilityForDay } from '@/lib/staff-assignment';
import { logAndRespond } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bizId = searchParams.get('bizId');
  const date = searchParams.get('date');
  const serviceId = searchParams.get('serviceId');

  if (!bizId || !date) {
    return NextResponse.json({ error: 'bizId et date requis' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Lu avant la requête d'occupation : détermine si le comptage doit être
  // isolé par service collectif, ou rester partagé (fallback inchangé).
  let service: { duration_minutes: number; allow_group: boolean } | null = null;
  if (serviceId) {
    const { data } = await supabase
      .from('services')
      .select('duration_minutes, allow_group')
      .eq('id', serviceId)
      .maybeSingle();
    service = data;
  }

  const isCollective = !!serviceId && service?.allow_group === true;

  let bookingsQuery = supabase
    .from('bookings')
    .select('time, staff_id, booking_members(status)')
    .eq('biz_id', bizId)
    .eq('date', date)
    .neq('status', 'cancelled');

  if (isCollective) {
    bookingsQuery = bookingsQuery.eq('service_id', serviceId!);
  }

  const { data: bookings, error } = await bookingsQuery;

  if (error) {
    return logAndRespond('[Availability] Erreur:', error);
  }

  const counts: Record<string, number> = {};
  for (const b of bookings || []) {
    const activeMembers = (b.booking_members || []).filter((m: any) => m.status !== 'cancelled');
    // b.time revient toujours au format "HH:MM:SS" via PostgREST (type `time`
    // Postgres), alors que le front (generateSlots()) travaille en "HH:MM" —
    // sans cette troncature, la clé ne matche JAMAIS côté client et
    // `isSlotFull` ne bloque jamais rien sur ce chemin (bug préexistant,
    // indépendant de l'isolation par service ci-dessus). Sûr de tronquer :
    // tous les créneaux sont générés par pas de 30 min, secondes toujours à
    // 0 (vérifié empiriquement sur les réservations existantes).
    const time = b.time.slice(0, 5);
    const key = isCollective ? `${time}::${(b as any).staff_id ?? ''}` : time;
    counts[key] = (counts[key] || 0) + activeMembers.length;
  }

  const responseBody: {
    counts: Record<string, number>;
    staffAvailability?: Record<string, { freeCount: number; freeStaffIds: string[] }>;
  } = { counts };

  if (service && service.allow_group === false) {
    // Business sans praticiens configurés (table staff vide) : pas de notion
    // de "praticien individuel" ici, on laisse staffAvailability absent pour
    // que le client retombe sur l'occupation par tête (counts) comme avant —
    // sinon un business qui n'utilise pas la feature staff verrait tous ses
    // créneaux "Complet" (freeCount toujours 0 avec staff: []).
    const staffAvailability = await computeStaffAvailabilityForDay(
      supabase,
      bizId,
      date,
      service.duration_minutes
    );
    if (staffAvailability) {
      const av = staffAvailability.availability;
      // Défense en profondeur : ne propager que si non vide (objet vide = businessOpenTime
      // nul dans computeStaffAvailability → sinon tous les créneaux retournent freeCount:0)
      if (Object.keys(av).length > 0) {
        responseBody.staffAvailability = av;
      }
    } else {
      // Business sans staff actif (pro solo) — même algorithme par durée
      // que le staff réel, appliqué au pro comme praticien virtuel unique.
      // Corrige un affichage qui ne tenait auparavant compte que du
      // comptage par tête (counts ci-dessus), jamais de la durée (trouvé en
      // audit 19/07 ; voir create_solo_booking_with_overlap_check,
      // migration 0035, pour le pendant écriture).
      const soloAvailability = await computeSoloAvailabilityForDay(
        supabase,
        bizId,
        date,
        service.duration_minutes
      );
      if (soloAvailability && Object.keys(soloAvailability).length > 0) {
        responseBody.staffAvailability = soloAvailability;
      }
    }
  }

  return NextResponse.json(responseBody);
}
