// src/lib/categories.ts
// Référentiel des catégories métier — source unique, volontairement sans
// dépendance server-only (contrairement à src/lib/queries/catalog.ts, qui
// réexporte ce fichier) pour rester importable depuis un composant client.
// Audit de cohérence du 15/08 : PartnerApplicationForm.tsx avait sa propre
// copie, avec des libellés divergents de celle utilisée par /recherche
// ("Bien-être" vs "Bien Être", "Sport & fitness" vs "Sport", "Coaching &
// développement personnel" vs "Coaching") et une description qui mentionnait
// "barber" sous "Beauté" alors que "Coiffure & Barber" existe déjà comme
// catégorie séparée. `service-name-suggestions.ts` reste un référentiel
// distinct par nature (suggestions de libellés de prestations, pas de
// catégories) — ne pas fusionner.
export const CATEGORIES = [
  { id: 'all', label: 'Tout' },
  { id: 'beaute', label: 'Beauté' },
  { id: 'bien-etre', label: 'Bien Être' },
  { id: 'sport', label: 'Sport' },
  { id: 'sante', label: 'Santé' },
  { id: 'soins-corps', label: 'Soins du corps' },
  { id: 'coiffure-barber', label: 'Coiffure & Barber' },
  { id: 'tatouage-piercing', label: 'Tatouage & Piercing' },
  { id: 'coaching', label: 'Coaching' },
  { id: 'animaux', label: 'Animaux' },
  { id: 'beaute-domicile', label: 'Beauté à domicile' },
  { id: 'photographie', label: 'Photographie' },
  { id: 'autre', label: 'Autre' },
] as const;
