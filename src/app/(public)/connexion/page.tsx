// src/app/(public)/connexion/page.tsx
import { Suspense } from 'react';
import LoginForm from '@/components/auth/LoginForm';

export default function ConnexionPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-white">Connexion</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
