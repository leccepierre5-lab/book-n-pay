/** @type {import('next').NextConfig} */

const securityHeaders = [
  // Empêche le sniffing de Content-Type par les navigateurs
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Empêche le clickjacking via iframe
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Force HTTPS pendant 2 ans (inclus sous-domaines + préchargement navigateur)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Réduit les données Referer envoyées aux sites tiers
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Désactive les APIs sensibles non utilisées — geolocation en self pour le tri "Près de moi" sur /recherche,
  // camera en self pour le check-in QR pro (/pro, QRScanner.tsx) — resté à
  // "()" par erreur alors que la feature est vendue (offre Starter, /tarifs),
  // la bloquant totalement en prod. Toujours refusé aux iframes tiers.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=()' },
  // Empêche les attaques XSS via Flash/IE
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // CSP : autorise Stripe, Supabase, Google Fonts + les ressources locales.
  //
  // TENTATIVE CSP À NONCE ABANDONNÉE (25/07, audit sécurité) : testé en
  // conditions réelles (Playwright headless contre le build de prod) —
  // Next.js 16.2.9 n'ajoute PAS automatiquement de nonce à ses propres
  // scripts (chunks JS + scripts inline de streaming RSC), contrairement à
  // ce que documente la recette officielle middleware. Avec 'strict-dynamic'
  // + nonce seul, TOUT est bloqué (24 violations CSP, y compris les chunks
  // externes — 'strict-dynamic' désactive l'allowlist par hôte, y compris
  // 'self', dès qu'aucun script n'a le nonce) : page rendue mais zéro JS
  // exécuté. 'unsafe-inline' reste donc nécessaire tant qu'aucune solution
  // de nonce fiable n'est trouvée pour ce setup. Ne pas retenter sans un
  // vrai mécanisme de propagation du nonce vérifié au préalable.
  //
  // 'unsafe-eval' RETIRÉ EN PROD seul (gain sans risque, vérifié en
  // conditions réelles) : nécessaire uniquement en dev (HMR/Fast Refresh
  // Turbopack), absent du bundle de production.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Scripts : app, Stripe, analytics Vercel. unsafe-eval dev uniquement.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''} https://js.stripe.com https://va.vercel-scripts.com`,
      // Styles : app + Google Fonts
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Fonts : Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Images : app, Supabase storage, Stripe
      "img-src 'self' data: blob: https://*.supabase.co https://q.stripe.com",
      // Connexions : Supabase, Stripe API, Resend, Vercel
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.resend.com https://va.vercel-scripts.com",
      // Frames : Stripe Checkout uniquement
      "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
      // Workers inline (Next.js)
      "worker-src 'self' blob:",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
