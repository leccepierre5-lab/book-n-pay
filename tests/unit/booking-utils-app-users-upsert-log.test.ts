// src/lib/booking-utils.ts::logAppUsersUpsertError — audit du 15/08 :
// l'upsert app_users dans bookings/create et bookings/create-group n'était
// jamais vérifié (motif "erreur≠zéro"). Une collision sur la contrainte
// UNIQUE(app_users.phone) échouait silencieusement. Ce helper ne bloque
// jamais l'appelant, il rend juste l'échec visible.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAppUsersUpsertError } from '@/lib/booking-utils';

describe('logAppUsersUpsertError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('erreur présente → log avec le label de route, le userId et le message', () => {
    logAppUsersUpsertError('BookingsCreate', 'user-42', { message: 'duplicate key value violates unique constraint "users_phone_key"' });
    expect(console.error).toHaveBeenCalledTimes(1);
    const [prefix, message] = (console.error as any).mock.calls[0];
    expect(prefix).toContain('[BookingsCreate]');
    expect(prefix).toContain('user-42');
    expect(message).toContain('users_phone_key');
  });

  it('erreur null → aucun log (chemin nominal)', () => {
    logAppUsersUpsertError('BookingsCreate', 'user-42', null);
    expect(console.error).not.toHaveBeenCalled();
  });
});
