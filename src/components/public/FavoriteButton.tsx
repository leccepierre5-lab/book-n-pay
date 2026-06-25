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
      className={`flex items-center justify-center w-10 h-10 rounded-2xl backdrop-blur-md transition-all duration-200 disabled:opacity-50 hover:scale-110 active:scale-95 ${
        favorited
          ? 'bg-red-500/20 border border-red-500/35'
          : 'bg-navy-950/70 border border-white/15 hover:bg-navy-900/80'
      }`}
    >
      <span className="text-lg leading-none">{favorited ? '❤️' : '🤍'}</span>
    </button>
  );
}
