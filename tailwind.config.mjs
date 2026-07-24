/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Identité Book'nPay — navy / mint green
        navy: {
          950: '#0f172a',
          900: '#1e293b',
          800: '#334155',
        },
        mint: {
          400: '#6ee7b7',
          500: '#34d399',
          600: '#10b981',
        },
        // Surcharge ciblée de 2 nuances slate par défaut (garde le reste de
        // l'échelle Tailwind intacte) — audit WCAG : slate-500 (#64748b) et
        // slate-600 (#475569) donnent ~2.95:1 et ~1.88:1 sur navy-900/950,
        // sous le seuil AA (4.5:1) requis pour le texte normal. 251 usages
        // dans src/, quasi tous du texte sur fond navy — corrigé ici plutôt
        // que remplacé fichier par fichier. Vérifié : aucun usage de ces deux
        // nuances sur fond clair dans ce repo (grep bg-white réel, hors
        // variantes bg-white/NN translucides) — la surcharge globale est
        // donc sûre. Nouvelles valeurs avec marge réelle au-dessus du seuil
        // (pas au ras du minimum) : 4.94:1 et 4.74:1 sur navy-900 (pire cas,
        // navy-950 est encore plus favorable).
        slate: {
          500: '#8a97ab',
          600: '#8694a7',
        },
      },
    },
  },
  plugins: [],
};
