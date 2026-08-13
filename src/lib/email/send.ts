// src/lib/email/send.ts
export async function sendEmail({
  to,
  subject,
  text,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  /** contentId, si posé, permet de référencer la pièce jointe en inline via <img src="cid:xxx"> (QR check-in, LOT 5 C6). */
  attachments?: { filename: string; content: string; contentId?: string }[];
}) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] (non envoyé — RESEND_API_KEY absente) →', to, subject);
    return { sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "Book'nPay <noreply@book-n-pay.com>",
        to,
        subject,
        text,
        html,
        ...(attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentId ? { content_id: a.contentId } : {}),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      console.warn('[Email] Échec envoi:', await res.text());
      return { sent: false };
    }
    return { sent: true };
  } catch (e: any) {
    console.warn('[Email] Erreur envoi:', e.message);
    return { sent: false };
  }
}

// SECURITY_TODO.md #5 — échappe toute valeur utilisateur (nom saisi à la
// réservation/inscription, nom d'établissement candidat, etc.) avant de
// l'interpoler dans un template HTML d'email. Ne jamais passer une valeur
// non échappée directement dans emailTemplate() ou un template inline.
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Bloc QR check-in (LOT 5, C6) — le code en clair reste TOUJOURS affiché à
// côté de l'image : c'est le repli si le client mail bloque la pièce jointe
// inline. `contentId` doit correspondre à l'attachment posé au même envoi
// (voir generateQrPngBase64, lib/qr.ts).
export function qrCheckinBlockHtml(code: string, contentId: string): string {
  return `
    <div style="text-align: center; margin: 20px 0; padding: 20px; background: #0b1220; border-radius: 16px; border: 1px solid #1e293b;">
      <img src="cid:${contentId}" alt="QR code de check-in" width="160" height="160" style="display: block; margin: 0 auto 12px; border-radius: 8px; background: #fff; padding: 8px;" />
      <p style="font-family: 'Courier New', Courier, monospace; font-size: 24px; font-weight: bold; letter-spacing: 6px; color: #ffffff; margin: 0 0 4px;">${escapeHtml(code)}</p>
      <p style="color: #64748b; font-size: 11px; margin: 0;">Présentez ce code à l&apos;accueil — utilisable même si l&apos;image ne s&apos;affiche pas.</p>
    </div>
  `;
}

// Template HTML de base — port du style emailBase() de verifierInactivite/entry.ts
export function emailTemplate(content: string): string {
  return `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 520px; margin: auto; background: #0f172a; border-radius: 20px; overflow: hidden; border: 1px solid #1e293b;">
      <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 28px 32px; text-align: center;">
        <p style="color: white; font-size: 22px; font-weight: bold; margin: 0;">Book'nPay</p>
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 4px 0 0;">Sérénité &amp; Fidélité</p>
      </div>
      <div style="padding: 32px;">
        ${content}
      </div>
      <div style="padding: 16px 32px; border-top: 1px solid #1e293b; text-align: center;">
        <p style="color: #475569; font-size: 11px; margin: 0;">Book'nPay — votre fidélité est votre assurance.</p>
      </div>
    </div>
  `;
}
