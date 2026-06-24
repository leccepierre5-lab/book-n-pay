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
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.jpg" alt="Book'nPay" width={36} height={36} className="rounded-full" priority />
          <span className="font-bold text-white text-base">Book'nPay</span>
        </Link>

        {/* Nav links (always visible) */}
        <div className="flex items-center gap-1">
          <Link href="/recherche" className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Réserver
          </Link>
          <Link href="/mes-reservations" className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Mes RDV
          </Link>
        </div>

        {/* Auth area */}
        {isLoggedIn ? (
          <Link
            href="/mes-reservations"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-mint-500/10 text-mint-400 hover:bg-mint-500/20 transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </Link>
        ) : (
          <Link
            href="/connexion"
            className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium text-mint-400 hover:bg-mint-500/10 transition-colors"
          >
            Se connecter
          </Link>
        )}
      </div>
    </nav>
  );
}
