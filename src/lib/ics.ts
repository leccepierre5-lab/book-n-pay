// src/lib/ics.ts
// Génère un fichier .ics (RFC 5545) pour les emails de RDV (confirmation,
// annulation) — zéro dépendance, Node natif (Buffer). UID stable sur toute
// la vie du RDV (booking.id + domaine), SEQUENCE incrémenté à chaque
// modification (report/annulation) pour que l'agenda du client se mette à
// jour au lieu de dupliquer l'événement.
export type IcsInput = {
  uid: string;
  start: Date; // instant réel (UTC) — construire via parseParisDatetime(date, time), jamais new Date(date+'T'+time)
  durationMin: number;
  summary: string;
  description?: string;
  location?: string;
  organizerName: string;
  // Les 4 appelants passent `contact@book-n-pay.com` (16/08, était noreply@
  // book-n-pay.com) — ATTENDEE porte RSVP=FALSE donc aucun client mail
  // conforme RFC 5545 ne devrait solliciter de réponse, mais certains
  // (Gmail Calendar notamment) affichent quand même Oui/Non/Peut-être pour
  // METHOD:REQUEST sans respecter RSVP=FALSE — une réponse cliquée part
  // alors en REPLY vers cette adresse. `contact@` est déjà la boîte support
  // publique surveillée (mentions légales, CGU, footer, corps des emails
  // d'annulation) : une réponse y atterrit au lieu de se perdre sur une
  // adresse noreply@ inexistante.
  organizerEmail: string;
  attendeeEmail: string;
  url?: string;
  sequence?: number;
  method?: 'REQUEST' | 'CANCEL';
};

const pad = (n: number) => String(n).padStart(2, '0');

const dt = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

// RFC 5545 §3.3.11 : échappement, PAS de guillemets autour de la valeur.
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 §3.1 : pliage des lignes à 75 octets (continuation = CRLF + espace).
const fold = (line: string) => {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let buf = Buffer.alloc(0);
  for (const ch of [...line]) {
    const b = Buffer.from(ch, 'utf8');
    const max = out.length === 0 ? 75 : 74;
    if (buf.length + b.length > max) {
      out.push(buf.toString('utf8'));
      buf = Buffer.alloc(0);
    }
    buf = Buffer.concat([buf, b]);
  }
  out.push(buf.toString('utf8'));
  return out[0] + out.slice(1).map((l) => '\r\n ' + l).join('');
};

export function buildIcs(i: IcsInput): string {
  const end = new Date(i.start.getTime() + i.durationMin * 60_000);
  const method = i.method ?? 'REQUEST';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Book'nPay//RDV//FR",
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `DTSTAMP:${dt(new Date())}`,
    `DTSTART:${dt(i.start)}`,
    `DTEND:${dt(end)}`,
    `SEQUENCE:${i.sequence ?? 0}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${esc(i.summary)}`,
    i.description ? `DESCRIPTION:${esc(i.description)}` : null,
    i.location ? `LOCATION:${esc(i.location)}` : null,
    i.url ? `URL:${i.url}` : null,
    `ORGANIZER;CN=${esc(i.organizerName)}:mailto:${i.organizerEmail}`,
    `ATTENDEE;CN=${esc(i.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${i.attendeeEmail}`,
    ...(method === 'REQUEST'
      ? ['BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(i.summary)}`, 'END:VALARM']
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[];
  return lines.map(fold).join('\r\n') + '\r\n';
}
