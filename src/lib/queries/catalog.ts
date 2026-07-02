// src/lib/queries/catalog.ts
// Requêtes de lecture publique du catalogue (businesses, services, avis).
// Utilisables depuis Server Components.
import { createClient } from '@/lib/supabase/server';
import type { Business, BusinessPhoto, Service, Staff } from '@/lib/database.types';

export interface BusinessWithDetails extends Business {
  services: Service[];
  staff: Staff[];
  business_reviews: { rating: number | null; review_count: number } | null;
  business_photos: BusinessPhoto[];
}

export interface SearchFilters {
  query?: string;
  category?: string;
  city?: string;
  sortBy?: 'default' | 'price_asc' | 'price_desc' | 'name' | 'rating';
  maxPrice?: number;
  minRating?: number;
}

export async function searchBusinesses(filters: SearchFilters): Promise<BusinessWithDetails[]> {
  const supabase = await createClient();

  let queryBuilder = supabase
    .from('businesses')
    .select('*, services(*), staff(*), business_reviews(rating, review_count)');

  if (filters.category && filters.category !== 'all') {
    if (filters.category === 'autre') {
      // "Autre" = tout ce qui n'est pas un secteur nommé (inclut aussi les
      // valeurs héritées creatif/education/enfants/food/services)
      const namedCategories = CATEGORIES.map((c) => c.id).filter((id) => id !== 'all' && id !== 'autre');
      for (const cat of namedCategories) {
        queryBuilder = queryBuilder.neq('category', cat);
      }
    } else {
      queryBuilder = queryBuilder.eq('category', filters.category);
    }
  }
  if (filters.city) {
    queryBuilder = queryBuilder.ilike('city', `%${filters.city}%`);
  }
  if (filters.query) {
    const q = filters.query;
    queryBuilder = queryBuilder.or(`name.ilike.%${q}%,city.ilike.%${q}%,type.ilike.%${q}%`);
  }

  // Exclut les établissements gelés par l'admin et ceux non publiés — sans ce
  // filtre, un business is_published=false apparaît dans la liste mais 404
  // sur sa page détail (getBusinessBySlug le filtre déjà), incohérence trouvée
  // en diagnostiquant un vrai 404 en prod sur les 45 établissements vitrine.
  queryBuilder = queryBuilder.eq('frozen', false).eq('is_published', true);

  const { data, error } = await queryBuilder;
  if (error) {
    console.error('[searchBusinesses]', error.message);
    return [];
  }

  let results = ((data || []) as unknown as BusinessWithDetails[]).map((b) => ({
    ...b,
    // N'expose que les praticiens actifs aux clients (inactifs = ex-employés)
    staff: (b.staff ?? []).filter((s) => s.is_active !== false),
  }));

  const minServicePrice = (biz: BusinessWithDetails) => {
    const prices = (biz.services ?? []).filter((s) => s.price > 0).map((s) => s.price);
    return prices.length ? Math.min(...prices) : Infinity;
  };

  if (filters.maxPrice) {
    results = results.filter((b) => minServicePrice(b) <= filters.maxPrice!);
  }
  if (filters.minRating) {
    results = results.filter((b) => (b.business_reviews?.rating || 0) >= filters.minRating!);
  }

  switch (filters.sortBy) {
    case 'price_asc':
      results = [...results].sort((a, b) => minServicePrice(a) - minServicePrice(b));
      break;
    case 'price_desc':
      results = [...results].sort((a, b) => minServicePrice(b) - minServicePrice(a));
      break;
    case 'name':
      results = [...results].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'rating':
      results = [...results].sort(
        (a, b) => (b.business_reviews?.rating || 0) - (a.business_reviews?.rating || 0)
      );
      break;
  }

  return results;
}

export async function getBusinessBySlug(slug: string): Promise<BusinessWithDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('businesses')
    .select('*, services(*), staff(*), business_reviews(rating, review_count), business_photos(id, url, sort_order, created_at, biz_id)')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();

  if (error) {
    console.error('[getBusinessBySlug]', error.message);
    return null;
  }
  if (!data) return null;
  const biz = data as unknown as BusinessWithDetails;
  return {
    ...biz,
    staff: (biz.staff ?? []).filter((s) => s.is_active !== false),
  };
}

export const CATEGORIES = [
  { id: 'all', label: 'Tout' },
  { id: 'beaute', label: 'Beauté' },
  { id: 'bien-etre', label: 'Bien Être' },
  { id: 'sport', label: 'Sport' },
  { id: 'sante', label: 'Santé' },
  { id: 'soins-corps', label: 'Soins du corps' },
  { id: 'coiffure-barber', label: 'Coiffure & Barber' },
  { id: 'tatouage-piercing', label: 'Tatouage & Piercing' },
  { id: 'coaching', label: 'Coaching' },
  { id: 'animaux', label: 'Animaux' },
  { id: 'beaute-domicile', label: 'Beauté à domicile' },
  { id: 'photographie', label: 'Photographie' },
  { id: 'autre', label: 'Autre' },
];

export const BAB_CITIES = [
  'Biarritz', 'Anglet', 'Bayonne', 'Saint-Jean-de-Luz', 'Hendaye',
  'Tarnos', 'Ondres', 'Boucau', 'Bidart', 'Guéthary', 'Ciboure',
  'Urrugne', 'Saint-Pée-sur-Nivelle', 'Ascain',
];
