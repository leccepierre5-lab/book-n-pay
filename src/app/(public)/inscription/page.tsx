// src/app/(public)/inscription/page.tsx
import { Suspense } from 'react';
import RegisterForm from '@/components/auth/RegisterForm';

export default function InscriptionPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-white">Créer un compte</h1>
        <Suspense>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
