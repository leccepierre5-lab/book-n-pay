'use client';
// src/components/group/JoinGroupClient.tsx
// Port condensé de src/pages/JoinGroup.jsx (727 lignes dans l'original).
// Couvre : chargement du booking + membres, compte à rebours d'expiration
// (30 min), formulaire pour rejoindre (nom + téléphone), paiement du
// nouveau membre, retrait d'un invité par l'organisateur. Ne couvre pas :
// partage natif (Web Share API), QR code d'accès affiché après paiement,
// animations avancées — l'original avait beaucoup plus de polish visuel.
import { useCallback, useEffect, useState } from 'react';

interface Member {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  deposit: number | null;
  invite_expiry: string | null;
}

interface BookingData {
  id: string;
  biz_name: string;
  service_name: string;
  date: string;
  time: string;
  status: string;
  booking_members: Member[];
  services?: { max_persons: number | null; deposit: number; price: number } | null;
}

export default function JoinGroupClient({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const callGroupApi = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch('/api/bookings/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, ...body }),
      });
      return res.json();
    },
    [bookingId]
  );

  const loadBooking = useCallback(async () => {
    const data = await callGroupApi({ action: 'getBooking' });
    if (data.error) {
      setError(data.error);
      setBooking(null);
    } else {
      setBooking(data.booking);
      setError(null);
    }
    setLoading(false);
  }, [callGroupApi]);

  useEffect(() => {
    loadBooking();
  }, [loadBooking]);

  useEffect(() => {
    const interval = setInterval(async () => {
      setNow(Date.now());
      const expired = booking?.booking_members.some(
        (m) => m.status === 'invite' && m.invite_expiry && new Date(m.invite_expiry).getTime() < Date.now()
      );
      if (expired) {
        await callGroupApi({ action: 'cancelExpiredBooking' });
        loadBooking();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [booking, callGroupApi, loadBooking]);

  const activeMembers = booking?.booking_members.filter((m) => m.status !== 'cancelled') || [];
  const hardLimit = booking?.services?.max_persons || 23;

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoining(true);
    setError(null);

    const dep = booking?.services?.deposit || 0;
    const data = await callGroupApi({
      action: 'addMemberAndGetCheckout',
      memberData: { name, phone, dep },
    });

    if (data.error) {
      setError(data.error);
      setJoining(false);
      return;
    }

    if (data.alreadyJoined) {
      await loadBooking();
      setJoining(false);
      return;
    }

    const checkoutRes = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: dep,
        fraisGestion: data.fraisGestion,
        bookingMeta: {
          bookingId,
          memberId: data.memberId,
          bizName: booking?.biz_name,
          serviceName: booking?.service_name,
          date: booking?.date,
          time: booking?.time,
          clientName: name,
          clientPhone: phone,
        },
        successUrl: `${window.location.origin}/confirmation?booking=${bookingId}`,
        cancelUrl: window.location.href,
      }),
    });
    const { url, error: checkoutError } = await checkoutRes.json();
    if (checkoutError) {
      setError(checkoutError);
      setJoining(false);
      return;
    }
    window.location.href = url;
  };

  const handleRemove = async (memberId: string) => {
    await callGroupApi({ action: 'removeInvite', memberId });
    loadBooking();
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-white/40">Chargement...</div>;
  }

  if (!booking) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-white/60">{error || 'Cette réservation de groupe est introuvable ou a expiré.'}</p>
      </div>
    );
  }

  const earliestExpiry = activeMembers
    .filter((m) => m.status === 'invite' && m.invite_expiry)
    .map((m) => new Date(m.invite_expiry!).getTime())
    .sort((a, b) => a - b)[0];

  const remainingMs = earliestExpiry ? earliestExpiry - now : null;
  const remainingLabel =
    remainingMs && remainingMs > 0
      ? `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
      : null;

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-semibold text-white">{booking.biz_name}</h1>
          <p className="text-sm text-white/60">
            {booking.service_name} · {booking.date} à {booking.time}
          </p>
        </div>

        {remainingLabel && (
          <div className="mb-5 rounded-xl border border-emerald-600/30 bg-emerald-950/30 px-4 py-2.5 text-center text-sm text-emerald-300">
            ⏱ Places réservées pour encore <strong>{remainingLabel}</strong>
          </div>
        )}

        <div className="mb-5 rounded-xl bg-navy-900 p-4">
          <p className="mb-3 text-sm font-medium text-white">
            Groupe ({activeMembers.length}/{hardLimit})
          </p>
          <div className="space-y-2">
            {activeMembers.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-navy-800 p-2">
                <span className="text-sm text-white">{m.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/40">
                    {m.status === 'paid' || m.status === 'arrived' ? '✓ Payé' : 'En attente'}
                  </span>
                  {m.status === 'invite' && (
                    <button onClick={() => handleRemove(m.id)} className="text-xs text-red-400 hover:text-red-300">
                      Retirer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {activeMembers.length < hardLimit && booking.status === 'active' && (
          <form onSubmit={handleJoin} className="space-y-3 rounded-xl bg-navy-900 p-4">
            <p className="text-sm font-medium text-white">Rejoindre le groupe</p>
            <input
              placeholder="Ton nom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg bg-navy-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
            />
            <input
              type="tel"
              placeholder="Ton téléphone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="w-full rounded-lg bg-navy-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={joining}
              className="w-full rounded-xl bg-mint-500 py-3 text-sm font-medium text-navy-950 disabled:opacity-50"
            >
              {joining ? 'Redirection...' : 'Payer ma place'}
            </button>
          </form>
        )}

        {booking.status !== 'active' && (
          <p className="text-center text-sm text-white/40">Cette réservation n'est plus disponible.</p>
        )}
      </div>
    </div>
  );
}
