// src/lib/qr.ts
// Génère l'image du QR check-in (LOT 5, C6) — encode toujours le même code à
// 6 chiffres déjà produit par generateQrCode() (booking-utils.ts) et déjà
// validé tel quel par /api/bookings/checkin-by-qr. Additif uniquement :
// aucun changement au scanner (QRScanner.tsx, décode du texte brut) ni à la
// validation serveur, qui continuent de comparer une chaîne — pas cette image.
import QRCode from 'qrcode';

export async function generateQrPngBase64(code: string): Promise<string> {
  const buffer = await QRCode.toBuffer(code, { type: 'png', width: 240, margin: 1 });
  return buffer.toString('base64');
}

export async function generateQrDataUrl(code: string): Promise<string> {
  return QRCode.toDataURL(code, { width: 200, margin: 1 });
}
