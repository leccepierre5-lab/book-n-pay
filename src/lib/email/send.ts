// src/lib/email/send.ts
// Centralise l'envoi d'email transactionnel. Remplace l'intégration interne
// Base44 (integrations.Core.SendEmail) par Resend — branche RESEND_API_KEY
// dans .env pour activer l'envoi réel. Sans clé, logge en console (no-op).
export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
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
      }),
    });
    if (!res.ok) {
      console.warn('[Email] Échec envoi:', await res.text());
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[Email] Erreur envoi:', e);
    return { sent: false };
  }
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
