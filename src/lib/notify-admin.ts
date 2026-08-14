// src/lib/notify-admin.ts
// Alerte email admin quand un cron à boucle (processBatch, lib/cron-batch.ts)
// a des échecs — avant ce fichier, `failed` était calculé et renvoyé en JSON
// mais jamais vu par personne (Vercel Cron n'inspecte pas le corps de la
// réponse, pas de Sentry — voir constat alerting du 23/07). Ne doit JAMAIS
// faire échouer le cron appelant : toute erreur d'envoi est avalée ici,
// jamais remontée à l'appelant.
import { sendEmail } from '@/lib/email/send';
import type { BatchResult } from '@/lib/cron-batch';

// `context` distingue une vraie boucle planifiée (Vercel Cron) d'une action
// synchrone déclenchée par un utilisateur (clic pro, webhook Stripe...) qui
// réutilise ce helper juste pour la visibilité admin. Avant ce paramètre, le
// mot "cron" était codé en dur dans le sujet quel que soit l'appelant —
// induit en erreur pendant le diagnostic du 14/08 (l'alerte
// "pro/cancel-booking:refund" ressemblait à un job périodique alors que
// c'était un échec ponctuel sur un clic pro). Défaut 'cron' : préserve le
// libellé existant pour tous les appelants sous src/app/api/cron/* sans les
// toucher.
export async function notifyAdminOnFailure<T>(
  label: string,
  result: BatchResult<T>,
  context: 'cron' | 'action' = 'cron'
): Promise<void> {
  if (result.failed === 0) return;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error(`[notifyAdmin] ADMIN_EMAIL absente — alerte non envoyée pour ${label} (${result.failed} échec(s))`);
    return;
  }

  try {
    await sendEmail({
      to: adminEmail,
      subject: `[Book'nPay] ${context} ${label} : ${result.failed} échec(s)`,
      text: `${context === 'cron' ? 'Le cron' : "L'action"} "${label}" a échoué sur ${result.failed} item(s) (${result.processed} traité(s) avec succès).

Items en échec :
${result.failedDescriptions.map((d) => `- ${d}`).join('\n')}`,
    });
  } catch (err: any) {
    console.error(`[notifyAdmin] Envoi de l'alerte a échoué pour ${label}:`, err?.message ?? err);
  }
}
