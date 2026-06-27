import { createBrowserClient } from '@supabase/ssr';

// Singleton explicite — garantit une seule instance GoTrue avec un seul
// setInterval d'auto-refresh, quel que soit le nombre de composants qui importent ce module.
let instance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!instance) {
    instance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return instance;
}
