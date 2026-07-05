// src/app/api/pro/export-clients/route.ts
// Export RGPD : le pro peut télécharger la liste de ses clients (nom,
// téléphone, email, historique) au format CSV. Agrège booking_members par
// téléphone normalisé, scope strict sur SON business (jamais cross-biz).
import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/booking-utils';

interface ClientAgg {
  name: string;
  phone: string;
  email: string | null;
  total: number;
  honored: number;
  lastDate: string;
}

// Neutralise l'injection de formule tableur (=, +, -, @, tab, CR en tête de
// cellule sont interprétés comme une formule par Excel/Sheets) en préfixant
// d'une apostrophe, avant l'échappement CSV classique.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function csvEscape(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[;"\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Accès interdit' }, { status: 403 });
  }

  const admin = createServiceRoleClient();

  const { data: rows } = await admin
    .from('booking_members')
    .select('name, phone, email, status, bookings!inner(biz_id, date, client_phone, client_email)')
    .eq('bookings.biz_id', profile.biz_id)
    .neq('status', 'invite');

  const map = new Map<string, ClientAgg>();

  for (const m of (rows ?? []) as any[]) {
    if (!m.phone) continue;
    const booking = m.bookings;
    const key = normalizePhone(m.phone);
    const email: string | null =
      m.email || (booking?.client_phone && normalizePhone(booking.client_phone) === key ? booking.client_email : null);
    const honored = m.status === 'paid' || m.status === 'arrived';
    const date: string = booking?.date || '';

    const existing = map.get(key);
    if (existing) {
      existing.total += 1;
      if (honored) existing.honored += 1;
      if (date > existing.lastDate) existing.lastDate = date;
      if (!existing.email && email) existing.email = email;
      if (m.name) existing.name = m.name;
    } else {
      map.set(key, { name: m.name || '', phone: m.phone, email, total: 1, honored: honored ? 1 : 0, lastDate: date });
    }
  }

  const clients = Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  const header = ['Nom', 'Téléphone', 'Email', 'RDV total', 'RDV honorés', 'Dernier RDV'];
  const lines = [header.join(';')];
  for (const c of clients) {
    lines.push(
      [c.name, c.phone, c.email || '', String(c.total), String(c.honored), c.lastDate]
        .map(csvEscape)
        .join(';')
    );
  }
  const BOM = '﻿';
  const csv = BOM + lines.join('\r\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clients-book-n-pay-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
