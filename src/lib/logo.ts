// src/lib/logo.ts
// Source unique des tailles de rendu du logo (même principe que
// plans-config pour les formules) — un futur ajustement se fait ici, jamais
// en dur dans chaque page qui affiche /logo.jpg (Navbar.tsx, connexion,
// inscription, HomeClient.tsx).
//
// +25% appliqué le 16/08 sur les 3 tailles historiques : header 34→43,
// hero de page (connexion/inscription) 56→70, hero accueil 80→100.
// Fichier source public/logo.jpg : 389×379px natif — largement suffisant
// même à la plus grande taille de rendu (100px × 3 pour du 3x retina =
// 300px, sous les 389px source), aucun flou attendu à aucune des 3 tailles.
export const LOGO_SIZES = {
  header: 43,
  pageHero: 70,
  homeHero: 100,
} as const;
