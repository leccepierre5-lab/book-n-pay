// src/lib/service-name-suggestions.ts
// Référentiel d'intitulés de prestation par catégorie (option D, chantier
// données de santé, 13/08/2026) — voir docs/referentiel-services-draft.md
// pour la genèse et le raisonnement complet.
//
// NE PAS réutiliser TYPE_PLACEHOLDERS (PartnerApplicationForm.tsx) : ce
// référentiel-ci liste des métiers ("Ostéopathe, Naturopathe…"), pas des
// intitulés de prestation — vocabulaires incompatibles, vérifié sur les
// vraies données du seed (supabase/seed/demo_services.sql).
//
// Patterns STRUCTURELS uniquement (durée/format/partie du corps/type de
// rendez-vous), jamais de raison ou de pathologie — la catégorie `sante`
// est volontairement la plus neutre du référentiel entier. "Consultation
// vétérinaire" (catégorie `animaux`) volontairement conservé : un
// vétérinaire prescrit à des animaux, aucune donnée de santé humaine,
// aucun rapport avec les professions réglementées écartées ailleurs
// (podologue, diététicien, psychologue) — objection initiale invalidée
// et retirée le 13/08.
//
// Objectif : couvrir ~80% des cas réels, pas l'exhaustivité — le reste
// passe par l'échappatoire "Autre" (texte libre, SERVICE_NAME_MAX_LENGTH).
// Volontairement une simple constante TS, modifiable sans migration : ce
// référentiel va figer ce que les pros peuvent vendre, il doit pouvoir
// s'enrichir vite si un cas réel manque.
//
// "Forfait plusieurs séances" (5 catégories) ne précise ni le nombre ni la
// nature — décision explicite (13/08) : ne pas le complexifier avec un
// champ quantité séparé, "Autre" absorbe les forfaits précis
// ("Forfait 5 séances", "Forfait 3 massages"...).
export const SERVICE_NAME_SUGGESTIONS: Record<string, string[]> = {
  beaute: ['Soin du visage', 'Manucure', 'Pédicure', 'Épilation', 'Maquillage', 'Forfait beauté'],
  'bien-etre': [
    'Séance de massage',
    'Cours de yoga (individuel)',
    'Cours de yoga (collectif)',
    'Séance de méditation',
    'Consultation initiale',
    'Forfait plusieurs séances',
  ],
  sport: [
    'Séance de coaching individuel',
    'Cours collectif',
    'Bilan forme',
    'Séance découverte',
    'Abonnement mensuel',
    'Forfait plusieurs séances',
  ],
  sante: [
    'Consultation initiale',
    'Séance de suivi',
    'Bilan',
    'Consultation enfant',
    'Téléconsultation',
    'Forfait plusieurs séances',
  ],
  'soins-corps': ['Soin du corps', 'Massage bien-être', 'Épilation', 'Accès spa / hammam', 'Séance UV', 'Forfait soins'],
  'coiffure-barber': ['Coupe femme', 'Coupe homme', 'Coupe + brushing', 'Couleur', 'Coiffure événementielle', 'Taille de barbe'],
  'tatouage-piercing': [
    'Consultation / devis',
    'Tatouage (petite pièce)',
    'Tatouage (pièce moyenne à grande)',
    'Piercing',
    'Retouche',
    'Maquillage permanent',
  ],
  coaching: [
    'Séance découverte',
    'Séance de coaching individuel',
    'Séance de suivi',
    'Bilan',
    'Forfait plusieurs séances',
    'Atelier collectif',
  ],
  animaux: ['Toilettage complet', 'Toilettage simple', 'Garde / pension', 'Promenade', "Séance d'éducation", 'Consultation vétérinaire'],
  'beaute-domicile': [
    'Coiffure à domicile',
    'Manucure à domicile',
    'Maquillage à domicile',
    'Soin du visage à domicile',
    'Forfait à domicile',
  ],
  photographie: ['Séance portrait', 'Séance famille', 'Reportage mariage', 'Séance nouveau-né', 'Shooting entreprise', 'Tirages / album'],
  autre: ['Consultation', 'Séance découverte', 'Séance de suivi', 'Forfait plusieurs séances', 'Prestation à la carte'],
};

export const SERVICE_NAME_AUTRE = 'Autre' as const;

// Limite du texte libre sous "Autre" — même principe de défense en
// profondeur que chat_messages (client + serveur + CHECK en base, jamais
// une seule couche). 60 caractères permet "Forfait 3 séances découverte",
// pas un descriptif clinique.
export const SERVICE_NAME_MAX_LENGTH = 60;

export function getServiceNameSuggestions(category: string | null | undefined): string[] {
  return SERVICE_NAME_SUGGESTIONS[category ?? ''] ?? SERVICE_NAME_SUGGESTIONS.autre;
}
