import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

const COMBINING_MARKS = /[̀-ͯ]/g;

function buildCode(firstName: string): string {
  const clean =
    firstName
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'USER';
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `BNP-${clean}${digits}`;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, name, referrerCode } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 });

    const supabase = createServiceRoleClient();

    const { data: user } = await supabase
      .from('app_users')
      .select('id, referral_code')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.referral_code) return NextResponse.json({ ok: true, skipped: true });

    let code = '';
    for (let i = 0; i < 5; i++) {
      const candidate = buildCode(name || 'USER');
      const { data: clash } = await supabase
        .from('app_users')
        .select('id')
        .eq('referral_code', candidate)
        .maybeSingle();
      if (!clash) { code = candidate; break; }
    }
    if (!code) code = buildCode((name || 'USER') + Date.now().toString().slice(-4));

    let referredBy: string | null = null;
    if (referrerCode) {
      const { data: referrer } = await supabase
        .from('app_users')
        .select('id')
        .eq('referral_code', referrerCode)
        .maybeSingle();
      if (referrer) referredBy = referrer.id;
    }

    await supabase
      .from('app_users')
      .update({
        referral_code: code,
        ...(referredBy ? { referred_by: referredBy } : {}),
      })
      .eq('id', userId);

    return NextResponse.json({ ok: true, referral_code: code, referred_by: referredBy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
