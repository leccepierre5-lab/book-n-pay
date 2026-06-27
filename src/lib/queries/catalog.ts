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
    queryBuilder = queryBuilder.eq('category', filters.category);
  }
  if (filters.city) {
    queryBuilder = queryBuilder.ilike('city', filters.city);
  }
  if (filters.query) {
    const q = filters.query;
    queryBuilder = queryBuilder.or(`name.ilike.%${q}%,city.ilike.%${q}%,type.ilike.%${q}%`);
  }

  // Exclut les établissements gelés par l'admin — sans ce filtre, ils
  // apparaissaient normalement dans la recherche et n'étaient bloqués
  // qu'au moment du paiement (trouvé par trace bout-en-bout : le gel
  // empêchait bien la réservation, mais l'UX laissait découvrir le
  // problème trop tard dans le parcours).
  queryBuilder = queryBuilder.eq('frozen', false);

  const { data, error } = await queryBuilder;
  if (error) {
    console.error('[searchBusinesses]', error.message);
    return [];
  }

  let results = (data || []) as unknown as BusinessWithDetails[];

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
    .maybeSingle();

  if (error) {
    console.error('[getBusinessBySlug]', error.message);
    return null;
  }
  return data as unknown as BusinessWithDetails | null;
}

export const CATEGORIES = [
  { id: 'all', label: 'Tout' },
  { id: 'beaute', label: 'Beauté' },
  { id: 'bien-etre', label: 'Bien Être' },
  { id: 'sport', label: 'Sport' },
  { id: 'enfants', label: '👶 Enfants' },
  { id: 'food', label: 'Food' },
  { id: 'education', label: 'Éducation' },
  { id: 'creatif', label: 'Créatif' },
  { id: 'services', label: 'Services' },
];

export const BAB_CITIES = [
  'Biarritz', 'Anglet', 'Bayonne', 'Saint-Jean-de-Luz', 'Hendaye',
  'Tarnos', 'Ondres', 'Boucau', 'Bidart', 'Guéthary', 'Ciboure',
  'Urrugne', 'Saint-Pée-sur-Nivelle', 'Ascain',
];
