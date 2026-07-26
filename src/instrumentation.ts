// src/instrumentation.ts
// Vérification au démarrage des variables d'env dont l'absence échoue
// silencieusement plutôt que de casser bruyamment une route — trouvé le
// 26/07 avec ADMIN_EMAIL (posée sous le mauvais nom, `ADMIN_email`, sur
// Vercel : notifyAdminOnFailure lisait `undefined`, loggait une ligne dans
// des logs que personne ne regarde, et n'alertait jamais personne pendant
// 3 jours — le filet censé rattraper les échecs de remboursement était
// lui-même en échec silencieux). register() tourne au cold start de chaque
// instance de fonction (Vercel/Next.js — pas un boot unique global, mais le
// seul point d'accroche disponible dans cette architecture serverless).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Volontairement restreint aux variables dont l'ABSENCE ne fait planter
  // rien de visible immédiatement (contrairement à NEXT_PUBLIC_SUPABASE_URL
  // par exemple, dont l'absence casse l'app entière au premier chargement) :
  // - ADMIN_EMAIL / RESEND_API_KEY : sendEmail()/notifyAdminOnFailure()
  //   avalent l'absence et continuent silencieusement (lib/email/send.ts,
  //   lib/notify-admin.ts) — c'est exactement le bug du 26/07.
  // - CRON_SECRET / INTERNAL_API_SECRET : les routes protégées renvoient un
  //   401 cohérent (pas un crash), mais rien ne surveille ces 401 en continu
  //   — un cron qui échoue nuit après nuit peut passer inaperçu des semaines.
  // - STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY : ne casse qu'au premier
  //   paiement/remboursement réellement tenté après un déploiement, jamais
  //   au déploiement lui-même.
  const CRITICAL_ENV_VARS = [
    'ADMIN_EMAIL',
    'RESEND_API_KEY',
    'CRON_SECRET',
    'INTERNAL_API_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_TEST_SECRET_KEY',
  ];

  const missing = CRITICAL_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `[BOOT] Variable(s) d'env critique(s) absente(s) : ${missing.join(', ')} — le(s) filet(s) associé(s) (alertes admin, crons, paiements) est/sont silencieusement désactivé(s) tant qu'elle(s) n'est/ne sont pas posée(s) sur Vercel.`
    );
  }
}
