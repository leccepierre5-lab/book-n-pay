'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

export default function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <nav className="sticky top-0 z-50 bg-navy-950 border-b border-white/5">
      <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.jpg" alt="Book'nPay" width={36} height={36} className="rounded-full" priority />
          <span className="font-bold text-white text-base hidden sm:block">Book'nPay</span>
        </Link>

        <div className="hidden sm:flex items-center gap-1">
          <Link href="/recherche" className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Réserver
          </Link>
          <Link href="/mes-reservations" className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Mes RDV
          </Link>
        </div>

        <Link
          href={isLoggedIn ? '/mes-reservations' : '/connexion'}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-mint-500/10 text-mint-400 hover:bg-mint-500/20 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
        </Link>
      </div>
    </nav>
  );
}
