// src/instrumentation.ts — audit 26/07 : ADMIN_EMAIL posée sous le mauvais
// nom (ADMIN_email) sur Vercel a laissé le filet d'alerte admin silencieux
// pendant 3 jours, sans qu'aucun log ne le signale. Ces tests prouvent que
// l'absence d'une variable d'env critique produit désormais un log explicite
// au boot, pour toute la classe (pas seulement ADMIN_EMAIL).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from '@/instrumentation';

const CRITICAL = ['ADMIN_EMAIL', 'RESEND_API_KEY', 'CRON_SECRET', 'INTERNAL_API_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_TEST_SECRET_KEY'];

let originalEnv: Record<string, string | undefined>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalEnv = { NEXT_RUNTIME: process.env.NEXT_RUNTIME };
  CRITICAL.forEach((k) => {
    originalEnv[k] = process.env[k];
    process.env[k] = 'set';
  });
  process.env.NEXT_RUNTIME = 'nodejs';
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Object.entries(originalEnv).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  errorSpy.mockRestore();
});

describe('instrumentation.register — vérif env critiques au boot', () => {
  it('toutes les variables présentes → aucun log', async () => {
    await register();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ADMIN_EMAIL absente → log explicite au boot (le bug du 26/07)', async () => {
    delete process.env.ADMIN_EMAIL;
    await register();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('ADMIN_EMAIL');
  });

  it('plusieurs variables absentes → toutes listées dans le même log', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.STRIPE_TEST_SECRET_KEY;
    await register();
    const msg = errorSpy.mock.calls[0][0] as string;
    expect(msg).toContain('CRON_SECRET');
    expect(msg).toContain('STRIPE_TEST_SECRET_KEY');
    expect(msg).not.toContain('ADMIN_EMAIL');
  });

  it("runtime edge (NEXT_RUNTIME !== 'nodejs') → ne fait rien, même variable absente", async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.ADMIN_EMAIL;
    await register();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
