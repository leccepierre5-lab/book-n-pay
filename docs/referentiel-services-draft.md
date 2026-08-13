# Référentiel `services.name` — draft (option D, 13/08/2026)

Proposé pour le chantier `services.name` (audit données de santé, suite de
[[project_bnp_health_data_audit]]) : select d'intitulés courants par
catégorie + échappatoire "Autre" en texte libre (60 caractères, validé
client+serveur+CHECK — aucun service existant ne dépasse déjà cette limite,
confirmé par requête le 13/08, migration non-rétroactive donc sans risque).

Ne réutilise PAS `TYPE_PLACEHOLDERS` (`PartnerApplicationForm.tsx`) — ce
référentiel liste des **métiers** (ex. "Ostéopathe, Naturopathe…"), pas des
**intitulés de prestation**. Les deux vocabulaires sont incompatibles,
vérifié sur les vraies données du seed (`supabase/seed/demo_services.sql`).

Principes : patterns **structurels** (durée/format/partie du corps/type de
rendez-vous), jamais de raison ou de pathologie. Assez large pour couvrir
~80% des cas réels, le reste passe par "Autre". Les 12 catégories de
`PartnerApplicationForm.tsx` (`CATEGORIES`) sont toutes couvertes.

## beaute
- Soin du visage
- Manucure
- Pédicure
- Épilation
- Maquillage
- Forfait beauté

## bien-etre
- Séance de massage
- Cours de yoga (individuel)
- Cours de yoga (collectif)
- Séance de méditation
- Consultation initiale
- Forfait plusieurs séances

## sport
- Séance de coaching individuel
- Cours collectif
- Bilan forme
- Séance découverte
- Abonnement mensuel
- Forfait plusieurs séances

## sante
Catégorie la plus sensible — formulations volontairement les plus neutres
du référentiel entier.
- Consultation initiale
- Séance de suivi
- Bilan
- Consultation enfant
- Téléconsultation
- Forfait plusieurs séances

## soins-corps
- Soin du corps
- Massage bien-être
- Épilation
- Accès spa / hammam
- Séance UV
- Forfait soins

## coiffure-barber
- Coupe femme
- Coupe homme
- Coupe + brushing
- Couleur
- Coiffure événementielle
- Taille de barbe

## tatouage-piercing
- Consultation / devis
- Tatouage (petite pièce)
- Tatouage (pièce moyenne à grande)
- Piercing
- Retouche
- Maquillage permanent

## coaching
- Séance découverte
- Séance de coaching individuel
- Séance de suivi
- Bilan
- Forfait plusieurs séances
- Atelier collectif

## animaux
- Toilettage complet
- Toilettage simple
- Garde / pension
- Promenade
- Séance d'éducation
- Consultation vétérinaire

## beaute-domicile
- Coiffure à domicile
- Manucure à domicile
- Maquillage à domicile
- Soin du visage à domicile
- Forfait à domicile

## photographie
- Séance portrait
- Séance famille
- Reportage mariage
- Séance nouveau-né
- Shooting entreprise
- Tirages / album

## autre
- Consultation
- Séance découverte
- Séance de suivi
- Forfait plusieurs séances
- Prestation à la carte

---

**En attente de la relecture de Pierre (2 réserves annoncées, notamment sur
`sante`) avant tout code.**
