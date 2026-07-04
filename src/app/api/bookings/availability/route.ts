// src/app/api/bookings/availability/route.ts
// Renvoie le nombre de personnes déjà inscrites par créneau pour un biz/date
// donné — équivalent de guestsAtSlot() mais calculé côté serveur avec des
// données fraîches (pas de risque de désync avec un state client périmé).
//
// `counts` (occupation par tête, tous praticiens confondus) reste inchangé —
// c'est toujours ce que consomme le flow de réservation aujourd'hui, y
// compris pour les services collectifs (allow_group === true), qui gardent
// ce mécanisme (un praticien/une salle sert plusieurs personnes à la fois).
//
// `staffAvailability` est un champ additif, calculé uniquement si `serviceId`
// est fourni, que le service est individuel (allow_group === false) ET que
// le business a au moins un praticien actif dans `staff`. Consommé par
// StepDateTime.tsx pour griser les créneaux par praticien plutôt que par
// tête. Absence de serviceId, ou business sans staff = comportement
// 100% identique à avant (counts).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeStaffAvailabilityForDay } from '@/lib/staff-assignment';
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
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('time, booking_members(status)')
    .eq('biz_id', bizId)
    .eq('date', date)
    .neq('status', 'cancelled');

  if (error) {
    return logAndRespond('[Availability] Erreur:', error);
  }

  const counts: Record<string, number> = {};
  for (const b of bookings || []) {
    const activeMembers = (b.booking_members || []).filter((m: any) => m.status !== 'cancelled');
    counts[b.time] = (counts[b.time] || 0) + activeMembers.length;
  }

  const responseBody: {
    counts: Record<string, number>;
    staffAvailability?: Record<string, { freeCount: number; freeStaffIds: string[] }>;
  } = { counts };

  if (serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes, allow_group')
      .eq('id', serviceId)
      .maybeSingle();

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
      }
    }
  }

  return NextResponse.json(responseBody);
}
