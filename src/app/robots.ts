import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Espaces authentifiés / parcours transactionnels : aucune valeur SEO,
      // et pour /admin, /pro, /api rien à indexer par nature. Les fiches
      // établissement non indexables (démo, gelées) sont gérées fiche par
      // fiche via la meta robots (generateMetadata), pas ici.
      disallow: [
        '/admin',
        '/pro',
        '/api',
        '/connexion',
        '/inscription',
        '/mon-compte',
        '/mes-reservations',
        '/mes-favoris',
        '/confirmation',
        '/pay',
        '/rejoindre',
        '/simulator',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
