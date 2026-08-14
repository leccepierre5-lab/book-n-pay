import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Tarifs — Abonnement fixe, 0% de commission",
  description:
    "Book'nPay : abonnement fixe, jamais de commission sur vos ventes. Comparez Starter, Business, Scale pour indépendants beauté & bien-être.",
  // Audit SEO 13/08, point 5 : page présente dans le sitemap (priority 0.6)
  // mais sans self-canonical.
  alternates: { canonical: '/tarifs' },
};

export default function TarifsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
