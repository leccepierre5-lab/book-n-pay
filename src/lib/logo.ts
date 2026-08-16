// src/lib/logo.ts
// Source unique des tailles de rendu du logo (même principe que
// plans-config pour les formules) — un futur ajustement se fait ici, jamais
// en dur dans chaque page qui affiche /logo.jpg (Navbar.tsx, connexion,
// inscription).
//
// +25% appliqué le 16/08 sur les tailles historiques : header 34→43,
// hero de page (connexion/inscription) 56→70. `homeHero` (80→100, logo
// géant centré du tunnel d'accueil) retiré le 16/08 (soir) : le tunnel
// utilise désormais le Navbar partagé en variante minimale (taille
// `header`) pour garantir un logo au même niveau vertical que le reste du
// site, cf. HomeClient.tsx.
// Fichier source public/logo.jpg : 389×379px natif — largement suffisant
// même à la plus grande taille de rendu (70px × 3 pour du 3x retina =
// 210px, sous les 389px source), aucun flou attendu.
export const LOGO_SIZES = {
  header: 43,
  pageHero: 70,
} as const;
