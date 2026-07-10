// src/lib/staff-group-order.ts
// Sous-morceaux purs de l'assignation praticiens CAS 2 (create-group/route.ts,
// branche useStaffAssignment), extraits pour être testables en isolation. La
// boucle principale elle-même reste dans la route : l'exclusion cumulative
// dépend du résultat réel de la RPC atomique à chaque itération (I/O), pas
// calculable à l'avance — voir mémoire projet pour le diagnostic complet.

// Staff id invalide/périmé (désactivé entre le chargement de la page et la
// soumission) : dégradé en "peu importe" (null) plutôt que de faire échouer
// tout le groupe pour une donnée cliente simplement obsolète.
export function normalizeStaffChoice(
  staffChoice: string | null,
  validStaffIds: Set<string>
): string | null {
  return staffChoice && validStaffIds.has(staffChoice) ? staffChoice : null;
}

// Choix précis d'abord (pour ne pas se faire voler leur praticien par une
// auto-assignation "peu importe" traitée avant eux), "peu importe" ensuite.
// L'ordre relatif à l'intérieur de chaque groupe est préservé (stabilité de
// Array.filter).
export function orderExplicitFirst<T extends { staffChoice: string | null }>(
  participants: T[]
): T[] {
  const explicit = participants.filter((p) => p.staffChoice !== null);
  const auto = participants.filter((p) => p.staffChoice === null);
  return [...explicit, ...auto];
}

// Candidats pour une personne étant donné l'exclusion déjà accumulée dans le
// groupe : un choix explicite reste seul candidat (jamais de repli silencieux
// vers un autre praticien), "peu importe" propose tous les praticiens pas
// encore assignés dans ce groupe.
export function getCandidateStaffIds(
  staffChoice: string | null,
  allStaffIds: string[],
  assignedStaffIds: Set<string>
): string[] {
  return staffChoice ? [staffChoice] : allStaffIds.filter((id) => !assignedStaffIds.has(id));
}
