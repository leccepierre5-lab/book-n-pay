// getBookingBlockedRole (src/lib/demo-mode.ts) est le check qui empêche un
// compte pro OU admin de réserver une prestation réelle avec son propre
// compte (bookings/create, bookings/create-group, masquage fiche
// établissement). Trouvé le 25/07 lors d'un audit navbar : l'ancien
// isProAccount() ne testait que role==='pro', un compte admin passait le
// check sans jamais être visé — verrouiller les 2 rôles ici pour ne pas
// régresser silencieusement sur l'un des deux.
import { describe, it, expect } from 'vitest';
import { getBookingBlockedRole, bookingBlockedMessage, PRO_CANNOT_BOOK_MESSAGE, ADMIN_CANNOT_BOOK_MESSAGE } from '@/lib/demo-mode';

function fakeSupabase(role: string | null) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: role ? { role } : null }),
        }),
      }),
    }),
  };
}

describe('getBookingBlockedRole', () => {
  it("role='client' → null, pas bloqué", async () => {
    const result = await getBookingBlockedRole(fakeSupabase('client'), 'u1');
    expect(result).toBeNull();
  });

  it("role='pro' → 'pro'", async () => {
    const result = await getBookingBlockedRole(fakeSupabase('pro'), 'u1');
    expect(result).toBe('pro');
  });

  it("role='admin' → 'admin' (le trou corrigé aujourd'hui)", async () => {
    const result = await getBookingBlockedRole(fakeSupabase('admin'), 'u1');
    expect(result).toBe('admin');
  });

  it('compte inconnu (maybeSingle → data null) → null', async () => {
    const result = await getBookingBlockedRole(fakeSupabase(null), 'u1');
    expect(result).toBeNull();
  });
});

describe('bookingBlockedMessage', () => {
  it("role 'pro' → message pro (mentionne 'établissement')", () => {
    expect(bookingBlockedMessage('pro')).toBe(PRO_CANNOT_BOOK_MESSAGE);
  });

  it("role 'admin' → message distinct (ne mentionne pas 'établissement')", () => {
    expect(bookingBlockedMessage('admin')).toBe(ADMIN_CANNOT_BOOK_MESSAGE);
    expect(ADMIN_CANNOT_BOOK_MESSAGE).not.toBe(PRO_CANNOT_BOOK_MESSAGE);
  });
});
