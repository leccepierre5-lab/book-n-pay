import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: "Réservation & paiement pour pros locaux",
};

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6 text-center">
      <Image
        src="/logo.jpg"
        alt="Book'nPay"
        width={120}
        height={120}
        className="rounded-full mb-6"
        priority
      />

      <h1 className="text-3xl font-bold text-white mb-3">
        Fini les clients fantômes !
      </h1>
      <p className="text-slate-400 text-base max-w-xs mb-8 leading-relaxed">
        Réservez votre créneau en toute sérénité. Votre place est confirmée instantanément,
        pour vous comme pour votre professionnel.
      </p>

      <Link
        href="/recherche"
        className="w-full max-w-xs rounded-xl bg-mint-500 py-3 text-center font-semibold text-navy-950 text-base mb-4"
      >
        Réserver maintenant →
      </Link>

      <Link
        href="/pro"
        className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        Espace professionnel
      </Link>

      <p className="mt-12 text-xs text-slate-600">
        En utilisant Book'nPay, vous acceptez nos{' '}
        <Link href="/cgu" className="text-slate-400 hover:underline">
          Conditions Générales d'Utilisation
        </Link>
      </p>
    </div>
  );
}
