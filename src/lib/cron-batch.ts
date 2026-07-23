// src/lib/cron-batch.ts
// Isole les échecs par item dans les crons à boucle — calqué sur le
// correctif d'expire-groups/route.ts (incident 22/07 : une exception sur un
// item arrêtait net le traitement de tous les suivants, sans qu'aucun
// remboursement/email/mise à jour restants ne soit tenté). Un seul point à
// maintenir plutôt qu'un for/try/catch réécrit dans chaque cron.
export interface BatchResult<T> {
  processed: number;
  failed: number;
  failedItems: T[];
  // Même identifiant lisible que celui loggé (describe(item)) — réutilisé par
  // notifyAdminOnFailure (lib/notify-admin.ts) pour le corps de l'email,
  // sans que l'appelant ait besoin de reproduire describe() une 2e fois.
  failedDescriptions: string[];
}

export async function processBatch<T>(
  items: T[],
  label: string,
  // Obligatoire — un objet complet loggé tel quel (JSON noyé, souvent
  // multi-lignes) n'aide personne à 3h du matin. Extrait l'identifiant
  // pertinent pour CE cron (email, ref, id...), à la charge de l'appelant
  // qui seul connaît la forme de T.
  describe: (item: T) => string,
  fn: (item: T) => Promise<void>
): Promise<BatchResult<T>> {
  let processed = 0;
  const failedItems: T[] = [];
  const failedDescriptions: string[] = [];

  for (const item of items) {
    try {
      await fn(item);
      processed++;
    } catch (err: any) {
      const desc = describe(item);
      console.error(`[${label}] Échec sur ${desc}:`, err?.message ?? err);
      failedItems.push(item);
      failedDescriptions.push(desc);
    }
  }

  if (failedItems.length > 0) {
    console.error(`[${label}] ${failedItems.length} échec(s) sur ${items.length}`);
  }

  return { processed, failed: failedItems.length, failedItems, failedDescriptions };
}
