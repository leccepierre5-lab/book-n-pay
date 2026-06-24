'use client';
import { useState } from 'react';

export default function FavoriteButton({
  bizId,
  initialFavorited,
}: {
  bizId: string;
  initialFavorited: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biz_id: bizId }),
    });
    if (res.ok) {
      const data = await res.json();
      setFavorited(data.favorited);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-label={favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className="rounded-full p-2 bg-navy-900/80 backdrop-blur-sm hover:bg-navy-800 transition-colors disabled:opacity-50"
    >
      <span className="text-xl">{favorited ? '❤️' : '🤍'}</span>
    </button>
  );
}
