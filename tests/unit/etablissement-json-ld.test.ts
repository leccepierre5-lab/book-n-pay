// Consigne SEO du 19/08 : JSON-LD LocalBusiness/sous-type + BreadcrumbList sur
// /etablissement/[slug]. Couvre le mapping catégorie -> @type, le calcul de
// priceRange, et la non-régression : un champ absent en base doit être omis
// du JSON-LD, jamais inventé (ex. pas d'aggregateRating).
import { describe, it, expect } from 'vitest';
import {
  buildBusinessJsonLd,
  buildBreadcrumbJsonLd,
} from '@/app/(public)/etablissement/[slug]/page';
import type { BusinessWithDetails } from '@/lib/queries/catalog';

function makeBusiness(overrides: Partial<BusinessWithDetails> = {}): BusinessWithDetails {
  return {
    id: 'biz-1',
    slug: 'institut-test',
    name: 'Institut Test',
    city: 'Bayonne',
    category: 'beaute',
    type: 'Institut de beauté',
    instagram: null,
    facebook_url: null,
    website: null,
    phone: null,
    google_place_url: null,
    google_place_id: null,
    open_time: null,
    close_time: null,
    open_days: [],
    pro_code: null,
    owner_id: 'owner-1',
    frozen: false,
    frozen_reason: null,
    is_published: true,
    service_area_radius_km: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    services: [],
    staff: [],
    business_reviews: null,
    business_photos: [],
    business_locations: null,
    ...overrides,
  };
}

describe('buildBusinessJsonLd', () => {
  it('mappe une catégorie connue vers son sous-type schema.org', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ category: 'tatouage-piercing' }), undefined);
    expect(jsonLd['@type']).toBe('TattooParlor');
  });

  it('retombe sur LocalBusiness pour une catégorie sans sous-type dédié (animaux)', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ category: 'animaux' }), undefined);
    expect(jsonLd['@type']).toBe('LocalBusiness');
  });

  it("retombe sur LocalBusiness pour une catégorie inconnue (jamais d'exception)", () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ category: 'inexistante' }), undefined);
    expect(jsonLd['@type']).toBe('LocalBusiness');
  });

  it('utilise address+geo quand address_public=true', () => {
    const jsonLd = buildBusinessJsonLd(
      makeBusiness({
        business_locations: {
          address: '1 rue du Port',
          postal_code: '64100',
          lat: 43.49,
          lng: -1.47,
          address_public: true,
        },
      }),
      undefined
    );
    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '1 rue du Port',
      postalCode: '64100',
      addressLocality: 'Bayonne',
      addressCountry: 'FR',
    });
    expect(jsonLd.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 43.49, longitude: -1.47 });
    expect(jsonLd.areaServed).toBeUndefined();
  });

  it('utilise areaServed (ville + rayon) quand address_public=false, jamais de coordonnée perso', () => {
    const jsonLd = buildBusinessJsonLd(
      makeBusiness({
        service_area_radius_km: 15,
        business_locations: {
          address: '1 rue du Port',
          postal_code: '64100',
          lat: 43.49,
          lng: -1.47,
          address_public: false,
        },
      }),
      undefined
    );
    expect(jsonLd.address).toBeUndefined();
    expect(jsonLd.geo).toBeUndefined();
    expect(jsonLd.areaServed).toEqual({ '@type': 'City', name: 'Bayonne (rayon 15 km)' });
  });

  it('omet address/geo/areaServed sans localisation ni ville', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ city: '' }), undefined);
    expect(jsonLd.address).toBeUndefined();
    expect(jsonLd.geo).toBeUndefined();
    expect(jsonLd.areaServed).toBeUndefined();
  });

  it('omet telephone/image quand absents en base', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness(), undefined);
    expect(jsonLd.telephone).toBeUndefined();
    expect(jsonLd.image).toBeUndefined();
  });

  it('inclut telephone/image quand présents', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ phone: '0611223344' }), 'https://cdn/photo.jpg');
    expect(jsonLd.telephone).toBe('0611223344');
    expect(jsonLd.image).toBe('https://cdn/photo.jpg');
  });

  it('calcule priceRange sur une plage de prix de services réels', () => {
    const jsonLd = buildBusinessJsonLd(
      makeBusiness({
        services: [
          { id: 's1', biz_id: 'biz-1', name: 'Coupe', genre: null, allow_group: false, duration_minutes: 30, deposit: 0, price: 25, max_persons: null, created_at: '' },
          { id: 's2', biz_id: 'biz-1', name: 'Coloration', genre: null, allow_group: false, duration_minutes: 60, deposit: 0, price: 80, max_persons: null, created_at: '' },
        ],
      }),
      undefined
    );
    expect(jsonLd.priceRange).toBe('25–80 €');
  });

  it('affiche un prix unique (pas de plage dégénérée) si tous les services ont le même prix', () => {
    const jsonLd = buildBusinessJsonLd(
      makeBusiness({
        services: [
          { id: 's1', biz_id: 'biz-1', name: 'Coupe', genre: null, allow_group: false, duration_minutes: 30, deposit: 0, price: 40, max_persons: null, created_at: '' },
        ],
      }),
      undefined
    );
    expect(jsonLd.priceRange).toBe('40 €');
  });

  it('omet priceRange sans service facturé', () => {
    const jsonLd = buildBusinessJsonLd(makeBusiness({ services: [] }), undefined);
    expect(jsonLd.priceRange).toBeUndefined();
  });

  it("n'ajoute jamais aggregateRating, même si business_reviews.rating est renseigné", () => {
    const jsonLd = buildBusinessJsonLd(
      makeBusiness({ business_reviews: { rating: 4.8, review_count: 12 } }),
      undefined
    );
    expect(jsonLd.aggregateRating).toBeUndefined();
  });

  it('construit openingHoursSpecification seulement si horaires + jours renseignés', () => {
    const withHours = buildBusinessJsonLd(
      makeBusiness({ open_time: '09:00:00', close_time: '18:00:00', open_days: [1, 2, 3] }),
      undefined
    );
    expect(withHours.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '18:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Tuesday', opens: '09:00', closes: '18:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Wednesday', opens: '09:00', closes: '18:00' },
    ]);

    const withoutDays = buildBusinessJsonLd(
      makeBusiness({ open_time: '09:00:00', close_time: '18:00:00', open_days: [] }),
      undefined
    );
    expect(withoutDays.openingHoursSpecification).toBeUndefined();
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('construit Accueil > Catégorie > Établissement pour une catégorie connue', () => {
    const breadcrumb = buildBreadcrumbJsonLd(makeBusiness({ category: 'beaute', name: 'Institut Test', slug: 'institut-test' }));
    expect(breadcrumb.itemListElement).toHaveLength(3);
    expect(breadcrumb.itemListElement[1]).toEqual({
      '@type': 'ListItem',
      position: 2,
      name: 'Beauté',
      item: 'https://www.book-n-pay.com/recherche?category=beaute',
    });
    expect(breadcrumb.itemListElement[2].name).toBe('Institut Test');
  });

  it('omet le niveau catégorie si la catégorie ne matche aucun label connu', () => {
    const breadcrumb = buildBreadcrumbJsonLd(makeBusiness({ category: 'inexistante' }));
    expect(breadcrumb.itemListElement).toHaveLength(2);
    expect(breadcrumb.itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });
});
