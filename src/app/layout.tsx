import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import PageTransition from '@/components/PageTransition';
import CookieBanner from '@/components/layout/CookieBanner';
import { BNP_PLANS } from '@/lib/plans-config';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const SITE_URL = 'https://www.book-n-pay.com';
const SITE_NAME = "Book'nPay";
const SITE_TITLE = "Book'nPay — Réservation en ligne beauté & bien-être";
const SITE_DESCRIPTION =
  "Réservez en ligne auprès d'indépendants beauté & bien-être du Pays Basque, Béarn et Landes. Paiement sécurisé, 0% de commission pour les pros.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | Book'nPay",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'fr_FR',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Dérivé de BNP_PLANS (source de vérité unique des prix, src/lib/plans-config.ts)
// plutôt que codé en dur ici, pour ne jamais désynchroniser le JSON-LD des vrais prix.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: BNP_PLANS.map((plan) => ({
        '@type': 'Offer',
        name: plan.label,
        price: plan.priceHT,
        priceCurrency: 'EUR',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: plan.priceHT,
          priceCurrency: 'EUR',
          billingDuration: 'P1M',
          valueAddedTaxIncluded: false,
        },
      })),
    },
    {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.jpg`,
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="bg-navy-950 text-slate-100 antialiased font-[var(--font-inter)]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <PageTransition>{children}</PageTransition>
        <CookieBanner />
      </body>
    </html>
  );
}
