// Version affichée sur /cgu ("Dernière mise à jour") — à incrémenter à chaque
// changement de texte pour que cgu_accepted_at/cgu_version restent traçables
// et opposables même après une modification future des CGU.
//
// Convention : 'AAAA-MM' pour le premier changement du mois, puis
// 'AAAA-MM-N' (N = 2, 3, ...) pour chaque bump supplémentaire le même mois —
// reste triable en comparaison de chaînes tant que N < 10 (pas encore
// arrivé). Ici : ajout de l'article 15 (chat / intitulés de prestation —
// interdiction des données de santé), voir docs/legal-archive/.
export const CGU_VERSION = '2026-08-2';

// ⚠️ TEXTE PROVISOIRE — "draft-1", PAS le texte définitif. Rédigé pour que le
// mécanisme (case à cocher + preuve serveur, migration 0045) soit testable
// avant validation juridique. Fondement pressenti : art. L221-28 1° du Code
// de la consommation (exécution pleine et entière du service avant la fin du
// délai de 14 jours, avec accord exprès et renoncement exprès du
// consommateur) — PAS le 12° "loisirs", qui ne couvre pas ces métiers (voir
// audit LOT 7, question CCI). Pierre remplacera ce texte après le RDV CCI ;
// c'est pour ça que RETRACTION_CONSENT_VERSION existe séparément de
// CGU_VERSION — changer l'un ne doit pas changer l'autre.
export const RETRACTION_CONSENT_TEXT =
  "Je demande que ma prestation commence avant la fin du délai de rétractation de 14 jours, et je reconnais que je ne pourrai plus exercer mon droit de rétractation une fois la prestation pleinement exécutée.";
export const RETRACTION_CONSENT_VERSION = 'draft-1';
