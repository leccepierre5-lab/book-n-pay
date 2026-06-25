import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import RegisterForm from '@/components/auth/RegisterForm';

export default function InscriptionPage() {
  return (
    <div className="relative flex min-h-[calc(100vh-56px)] items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.05)_0%,transparent_65%)] pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.jpg" alt="Book'nPay" width={56} height={56} className="rounded-2xl ring-2 ring-mint-500/20 shadow-[0_0_24px_rgba(52,211,153,0.2)] mb-4" priority />
          <h1 className="text-xl font-bold text-white">Créer un compte</h1>
          <p className="text-sm text-slate-500 mt-1">Rejoignez Book'nPay gratuitement</p>
        </div>
        <Suspense>
          <RegisterForm />
        </Suspense>
        <p className="mt-6 text-center text-xs text-slate-600">
          Déjà un compte ?{' '}
          <Link href="/connexion" className="text-mint-400 hover:text-mint-300 transition-colors">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
