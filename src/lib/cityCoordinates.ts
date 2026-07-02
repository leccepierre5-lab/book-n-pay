// src/lib/cityCoordinates.ts
// Coordonnées approximatives (centre-ville) des communes couvertes par
// Book'nPay — voir supabase/seed/demo_businesses.sql (49 villes, 64+40).
// `businesses` ne stocke qu'un nom de ville en clair, pas d'adresse précise
// ni de lat/lng : la géolocalisation "près de moi" est donc au niveau de la
// ville, pas de l'établissement exact. Suffisant pour trier/filtrer par
// proximité sans migration ni géocodage d'adresse à ce stade.
export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  // Pyrénées-Atlantiques (64)
  'Anglet': { lat: 43.483, lng: -1.522 },
  'Artix': { lat: 43.408, lng: -0.617 },
  'Arzacq-Arraziguet': { lat: 43.522, lng: -0.347 },
  'Arzacq': { lat: 43.522, lng: -0.347 },
  'Bayonne': { lat: 43.493, lng: -1.475 },
  'Biarritz': { lat: 43.483, lng: -1.559 },
  'Billère': { lat: 43.305, lng: -0.393 },
  'Cambo-les-Bains': { lat: 43.360, lng: -1.406 },
  'Garlin': { lat: 43.551, lng: -0.274 },
  'Hasparren': { lat: 43.381, lng: -1.303 },
  'Hendaye': { lat: 43.363, lng: -1.772 },
  'Idron': { lat: 43.327, lng: -0.327 },
  'Jurançon': { lat: 43.289, lng: -0.390 },
  'Lembeye': { lat: 43.579, lng: -0.231 },
  'Lescar': { lat: 43.331, lng: -0.424 },
  'Lons': { lat: 43.301, lng: -0.393 },
  'Mauléon-Licharre': { lat: 43.221, lng: -0.881 },
  'Monein': { lat: 43.321, lng: -0.523 },
  'Morlaàs': { lat: 43.343, lng: -0.267 },
  'Mourenx': { lat: 43.381, lng: -0.564 },
  'Navarrenx': { lat: 43.327, lng: -0.756 },
  'Nay': { lat: 43.184, lng: -0.261 },
  'Oloron-Sainte-Marie': { lat: 43.193, lng: -0.608 },
  'Orthez': { lat: 43.490, lng: -0.769 },
  'Pau': { lat: 43.295, lng: -0.371 },
  'Pontacq': { lat: 43.190, lng: -0.144 },
  'Saint-Jean-de-Luz': { lat: 43.389, lng: -1.663 },
  'Salies-de-Béarn': { lat: 43.476, lng: -0.920 },
  'Tardets-Sorholus': { lat: 43.097, lng: -0.878 },
  'Tardets': { lat: 43.097, lng: -0.878 },
  'Thèze': { lat: 43.450, lng: -0.295 },

  // Landes (40)
  "Aire-sur-l'Adour": { lat: 43.701, lng: -0.259 },
  'Amou': { lat: 43.646, lng: -0.601 },
  'Biscarrosse': { lat: 44.390, lng: -1.164 },
  'Capbreton': { lat: 43.643, lng: -1.431 },
  'Dax': { lat: 43.710, lng: -1.051 },
  'Hagetmau': { lat: 43.655, lng: -0.587 },
  'Hagetmauze': { lat: 43.655, lng: -0.587 },
  'Hossegor': { lat: 43.667, lng: -1.433 },
  'Labrit': { lat: 44.112, lng: -0.544 },
  'Mimizan': { lat: 44.200, lng: -1.229 },
  'Mont-de-Marsan': { lat: 43.890, lng: -0.498 },
  'Morcenx': { lat: 44.038, lng: -0.915 },
  'Mugron': { lat: 43.742, lng: -0.750 },
  'Parentis-en-Born': { lat: 44.357, lng: -1.066 },
  'Peyrehorade': { lat: 43.542, lng: -1.117 },
  'Roquefort': { lat: 44.061, lng: -0.319 },
  'Sabres': { lat: 44.145, lng: -0.734 },
  'Saint-Sever': { lat: 43.759, lng: -0.573 },
  'Saint-Vincent-de-Tyrosse': { lat: 43.667, lng: -1.301 },
  'Soustons': { lat: 43.755, lng: -1.318 },
  'Tartas': { lat: 43.836, lng: -0.809 },
};

// Formule de Haversine — distance à vol d'oiseau en km entre deux points.
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Résout les coordonnées d'une ville en essayant le nom exact puis une
// comparaison insensible à la casse/aux accents (le nom en base est parfois
// saisi librement par le pro, ex. "Bayonne" vs "bayonne").
export function getCityCoordinates(city: string | null | undefined): { lat: number; lng: number } | null {
  if (!city) return null;
  if (CITY_COORDINATES[city]) return CITY_COORDINATES[city];

  const normalized = city.trim().toLowerCase();
  const match = Object.keys(CITY_COORDINATES).find((c) => c.toLowerCase() === normalized);
  return match ? CITY_COORDINATES[match] : null;
}
