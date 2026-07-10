// Sous-morceaux purs de l'assignation praticiens CAS 2 (create-group/route.ts)
// — voir src/lib/staff-group-order.ts. Chantier historiquement fragile
// (plusieurs bugs d'ordonnancement passés, voir mémoire projet pitfall #34) :
// tout changement silencieux sur l'ordre de traitement ou le calcul des
// candidats vole un praticien à la mauvaise personne, sans erreur visible.
import { describe, it, expect } from 'vitest';
import {
  normalizeStaffChoice,
  orderExplicitFirst,
  getCandidateStaffIds,
} from '@/lib/staff-group-order';

describe('normalizeStaffChoice', () => {
  it('choix valide (présent dans validStaffIds) → conservé tel quel', () => {
    expect(normalizeStaffChoice('staff-1', new Set(['staff-1', 'staff-2']))).toBe('staff-1');
  });

  it('choix invalide (staff désactivé/périmé) → dégradé en null, pas d\'erreur', () => {
    expect(normalizeStaffChoice('staff-old', new Set(['staff-1', 'staff-2']))).toBeNull();
  });

  it('null (déjà "peu importe") → reste null', () => {
    expect(normalizeStaffChoice(null, new Set(['staff-1']))).toBeNull();
  });

  it('validStaffIds vide → tout choix dégradé en null', () => {
    expect(normalizeStaffChoice('staff-1', new Set())).toBeNull();
  });
});

describe('orderExplicitFirst', () => {
  it('choix explicites passés avant les "peu importe", peu importe leur position d\'origine', () => {
    const participants = [
      { id: 'a', staffChoice: null },
      { id: 'b', staffChoice: 'staff-1' },
      { id: 'c', staffChoice: null },
      { id: 'd', staffChoice: 'staff-2' },
    ];
    const ordered = orderExplicitFirst(participants);
    expect(ordered.map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('ordre relatif préservé à l\'intérieur de chaque groupe (stabilité)', () => {
    const participants = [
      { id: 'a', staffChoice: 'staff-1' },
      { id: 'b', staffChoice: 'staff-2' },
      { id: 'c', staffChoice: 'staff-3' },
    ];
    expect(orderExplicitFirst(participants).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('tous "peu importe" → ordre d\'origine inchangé', () => {
    const participants = [
      { id: 'a', staffChoice: null },
      { id: 'b', staffChoice: null },
    ];
    expect(orderExplicitFirst(participants).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('liste vide → liste vide', () => {
    expect(orderExplicitFirst([])).toEqual([]);
  });
});

describe('getCandidateStaffIds', () => {
  it('choix explicite → seul candidat, jamais de repli silencieux même si d\'autres sont libres', () => {
    const result = getCandidateStaffIds('staff-1', ['staff-1', 'staff-2', 'staff-3'], new Set());
    expect(result).toEqual(['staff-1']);
  });

  it('"peu importe" → tous les praticiens non encore assignés dans ce groupe', () => {
    const result = getCandidateStaffIds(null, ['staff-1', 'staff-2', 'staff-3'], new Set(['staff-1']));
    expect(result).toEqual(['staff-2', 'staff-3']);
  });

  it('"peu importe", aucune exclusion encore → tous les praticiens', () => {
    const result = getCandidateStaffIds(null, ['staff-1', 'staff-2'], new Set());
    expect(result).toEqual(['staff-1', 'staff-2']);
  });

  it('"peu importe", tous déjà assignés → liste vide (assignStaffAndCreateBooking renverra null)', () => {
    const result = getCandidateStaffIds(null, ['staff-1', 'staff-2'], new Set(['staff-1', 'staff-2']));
    expect(result).toEqual([]);
  });
});
