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
  // Désactive les APIs sensibles non utilisées
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Empêche les attaques XSS via Flash/IE
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // CSP : autorise Stripe, Supabase, Google Fonts + les ressources locales
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Scripts : app, Stripe, analytics Vercel
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://va.vercel-scripts.com",
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
