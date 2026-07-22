// Audit du 22/07 : la boucle du cron expire-groups n'avait pas de try/catch
// par itération — un groupe qui lève une exception arrêtait net le
// traitement des groupes suivants, sans log ni compte visible. Ce test
// prouve que ce n'est plus le cas : un échec est isolé, loggé, et compté
// séparément des succès dans la réponse.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        not: () => ({
          lt: () => ({
            eq: () => ({
              not: async () => ({
                data: [
                  { group_ref: 'group-ok-1' },
                  { group_ref: 'group-fail' },
                  { group_ref: 'group-ok-2' },
                ],
              }),
            }),
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/constant-time', () => ({
  isValidBearerSecret: vi.fn(() => true),
}));

const expireGroupByRef = vi.fn(async (ref: string) => {
  if (ref === 'group-fail') {
    throw new Error('boom');
  }
  return { expired: true };
});

vi.mock('@/lib/group/expireGroup', () => ({
  expireGroupByRef: (...args: any[]) => expireGroupByRef(...(args as [string, any, any])),
}));

describe('GET /api/cron/expire-groups', () => {
  beforeEach(() => {
    expireGroupByRef.mockClear();
    process.env.CRON_SECRET = 'test-secret';
  });

  it("isole l'échec d'un groupe : les autres sont traités et le décompte reflète les deux", async () => {
    const { GET } = await import('@/app/api/cron/expire-groups/route');

    const req = new Request('http://localhost/api/cron/expire-groups', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const res = await GET(req as any);
    const body = await res.json();

    // Les 3 groupes ont bien été tentés — la boucle ne s'est pas arrêtée
    // à la première exception.
    expect(expireGroupByRef).toHaveBeenCalledTimes(3);

    expect(body.processed).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.failedRefs).toEqual(['group-fail']);
  });
});
