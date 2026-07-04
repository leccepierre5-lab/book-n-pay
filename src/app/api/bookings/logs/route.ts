import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bookingId = searchParams.get('bookingId');
  if (!bookingId) return NextResponse.json({ error: 'bookingId requis' }, { status: 400 });

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, biz_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.role !== 'pro' && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux professionnels' }, { status: 403 });
  }

  if (profile.role === 'pro') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('biz_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking || booking.biz_id !== profile.biz_id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }
  }

  const { data, error } = await supabase
    .from('booking_logs')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });

  if (error) return logAndRespond('[BookingLogs] Erreur:', error);
  return NextResponse.json(data);
}
