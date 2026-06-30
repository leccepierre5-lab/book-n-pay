import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';

export default function ConnexionPage() {
  return (
    <div className="relative flex min-h-[calc(100vh-56px)] flex-col items-center justify-start px-4 pt-8 pb-8">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.05)_0%,transparent_65%)] pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-5">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Retour
        </Link>
        <div className="flex flex-col items-center mb-6">
          <Image src="/logo.jpg" alt="Book'nPay" width={56} height={56} className="rounded-2xl ring-2 ring-mint-500/20 shadow-[0_0_24px_rgba(52,211,153,0.2)]" priority />
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-6">
          <p className="text-base font-semibold text-slate-300 mb-5">Content de vous revoir</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-5 text-center text-xs text-slate-600">
          Pas encore de compte ?{' '}
          <Link href="/inscription" className="text-mint-400 hover:text-mint-300 transition-colors">
            S'inscrire gratuitement
          </Link>
        </p>
      </div>
    </div>
  );
}
