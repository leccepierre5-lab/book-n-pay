// resolveMemberRecipientEmail (src/lib/booking-utils.ts) — bug réel trouvé
// en audit (26/07) : 3 sites (send-rdv-reminders, send-rdv-reminders-j2,
// cloturer-prestation) dérivaient l'adresse du destinataire uniquement par
// correspondance `member.phone === booking.client_phone`, en ignorant
// `member.email` (renseigné pour CHAQUE membre dès son propre paiement,
// organisateur ou invité de groupe — voir stripe/webhook/route.ts). Un
// invité de groupe (téléphone différent de l'organisateur) ne recevait donc
// jamais son rappel J-1/J-2 ni son email de clôture de prestation.
import { describe, it, expect } from 'vitest';
import { resolveMemberRecipientEmail } from '@/lib/booking-utils';

describe('resolveMemberRecipientEmail', () => {
  it('priorise toujours member.email quand il existe (organisateur ou invité)', () => {
    expect(
      resolveMemberRecipientEmail(
        { email: 'invite@example.com', phone: '+33600000002' },
        { client_phone: '+33600000001', client_email: 'organisateur@example.com' }
      )
    ).toBe('invite@example.com');
  });

  it("invité de groupe (téléphone différent de l'organisateur, sans member.email) — cas du bug réel, ne doit plus renvoyer null silencieusement à tort si l'email existe ailleurs", () => {
    // Reproduit le scénario exact du bug : avant le fix, ce cas renvoyait
    // `null` alors même qu'un invité qui a payé a nécessairement un
    // member.email posé par le webhook — ce test documente le fallback
    // pour le cas résiduel où member.email est vraiment absent.
    expect(
      resolveMemberRecipientEmail(
        { email: null, phone: '+33600000002' },
        { client_phone: '+33600000001', client_email: 'organisateur@example.com' }
      )
    ).toBeNull();
  });

  it("fallback sur client_email uniquement si le téléphone du membre correspond à celui de l'organisateur", () => {
    expect(
      resolveMemberRecipientEmail(
        { email: null, phone: '+33600000001' },
        { client_phone: '+33600000001', client_email: 'organisateur@example.com' }
      )
    ).toBe('organisateur@example.com');
  });

  it('aucun téléphone renseigné côté membre ou booking → null, pas de crash', () => {
    expect(
      resolveMemberRecipientEmail(
        { email: null, phone: null },
        { client_phone: null, client_email: 'organisateur@example.com' }
      )
    ).toBeNull();
  });
});
