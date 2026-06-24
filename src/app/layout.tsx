import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="fr">
      <body className="bg-navy-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
