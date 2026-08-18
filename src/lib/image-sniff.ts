// src/lib/image-sniff.ts
// Audit sécurité 18/08 : api/pro/photos ne vérifiait que l'extension du nom
// de fichier et stockait le Content-Type tel que déclaré par le client
// (`file.type`) — les deux sont falsifiables sans effort (renommer un
// fichier en .jpg, forger le champ Content-Type d'une requête multipart
// directe). Un polyglotte servi publiquement avec un Content-Type falsifié
// est une porte d'entrée XSS/exécution stockée. Ce module lit les octets
// RÉELS (signature binaire) plutôt que de faire confiance à une métadonnée
// fournie par l'appelant — jamais de librairie externe pour un besoin aussi
// restreint (3 formats), plus simple à auditer que d'ajouter une dépendance.
export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const SIGNATURES: { type: SniffedImageType; ext: string; check: (b: Uint8Array) => boolean }[] = [
  {
    type: 'image/png',
    ext: 'png',
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    type: 'image/jpeg',
    ext: 'jpg',
    check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/webp',
    ext: 'webp',
    // RIFF....WEBP — "RIFF" en 0-3, taille en 4-7 (ignorée), "WEBP" en 8-11.
    check: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

// Renvoie null si aucune signature connue ne matche — jamais un type déduit
// de l'extension ou du Content-Type déclaré, uniquement des octets réels.
export function sniffImageType(bytes: ArrayBuffer | Uint8Array): { type: SniffedImageType; ext: string } | null {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const sig of SIGNATURES) {
    if (sig.check(buf)) return { type: sig.type, ext: sig.ext };
  }
  return null;
}
