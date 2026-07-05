import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import PageTransition from '@/components/PageTransition';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: "Book'nPay",
    template: "%s | Book'nPay",
  },
  description:
    "Book'nPay connecte les professionnels de Biarritz, Anglet et Bayonne à leurs clients : réservation en ligne, paiement sécurisé, zéro commission.",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="bg-navy-950 text-slate-100 antialiased font-[var(--font-inter)]">
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
