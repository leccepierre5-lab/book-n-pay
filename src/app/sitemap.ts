import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';
import { getSitemapBusinesses } from '@/lib/queries/catalog';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const businesses = await getSitemapBusinesses();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/recherche`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/tarifs`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/devenir-partenaire`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/mentions-legales`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/cgu`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const businessRoutes: MetadataRoute.Sitemap = businesses.map((b) => ({
    url: `${SITE_URL}/etablissement/${b.slug}`,
    lastModified: b.updated_at,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...staticRoutes, ...businessRoutes];
}
