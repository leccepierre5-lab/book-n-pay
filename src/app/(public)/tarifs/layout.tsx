import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Tarifs — Abonnement fixe, 0% de commission",
  description:
    "Book'nPay : abonnement fixe, jamais de commission sur vos ventes. Comparez Starter, Business, Scale pour indépendants beauté & bien-être.",
};

export default function TarifsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
