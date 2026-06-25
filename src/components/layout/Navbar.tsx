'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const pathname = usePathname();

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

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="sticky top-0 z-50 bg-navy-950/90 backdrop-blur-xl border-b border-white/[0.06]">
      <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <div className="relative">
            <Image src="/logo.jpg" alt="Book'nPay" width={34} height={34} className="rounded-full ring-1 ring-white/10 group-hover:ring-mint-500/40 transition-all duration-200" priority />
            <div className="absolute inset-0 rounded-full bg-mint-500/0 group-hover:bg-mint-500/5 transition-all duration-200" />
          </div>
          <span className="font-bold text-white text-sm tracking-tight">Book'nPay</span>
        </Link>

        <div className="flex items-center gap-0.5">
          <Link
            href="/recherche"
            className={`px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
              isActive('/recherche')
                ? 'text-mint-400 bg-mint-500/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Réserver
          </Link>
          <Link
            href="/mes-reservations"
            className={`px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
              isActive('/mes-reservations')
                ? 'text-mint-400 bg-mint-500/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Mes RDV
          </Link>
        </div>

        {isLoggedIn ? (
          <Link
            href="/mes-reservations"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-mint-500/15 text-mint-400 hover:bg-mint-500/25 transition-all duration-200 ring-1 ring-mint-500/20 hover:ring-mint-500/40 shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </Link>
        ) : (
          <Link
            href="/connexion"
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-mint-400 hover:bg-mint-500/10 transition-all duration-200 ring-1 ring-mint-500/20 hover:ring-mint-500/40"
          >
            Connexion
          </Link>
        )}
      </div>
    </nav>
  );
}
