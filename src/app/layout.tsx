import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="bg-navy-950 text-slate-100 antialiased font-[var(--font-inter)]">
        {children}
      </body>
    </html>
  );
}
