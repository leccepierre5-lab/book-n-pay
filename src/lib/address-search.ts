// Autocomplétion + géocodage d'adresse via l'API officielle
// adresse.data.gouv.fr (Base Adresse Nationale) — gratuite, sans clé,
// CORS ouvert. Appelable depuis un composant client.
export interface AddressSuggestion {
  label: string;
  postcode: string;
  city: string;
  lat: number;
  lng: number;
}

export async function searchAddress(query: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const res = await fetch(
    `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(trimmed)}&limit=5&autocomplete=1`
  );
  if (!res.ok) return [];

  const json = await res.json();
  const features = Array.isArray(json.features) ? json.features : [];

  return features.map((f: { properties: { label: string; postcode: string; city: string }; geometry: { coordinates: [number, number] } }) => ({
    label: f.properties.label,
    postcode: f.properties.postcode,
    city: f.properties.city,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
