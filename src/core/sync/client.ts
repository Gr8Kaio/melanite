import type { SupabaseClient } from '@supabase/supabase-js';

let client: Promise<SupabaseClient | null> | null = null;

/**
 * Cliente de Supabase (uno solo por app) con la sesión guardada en localStorage
 * y renovación automática del token. null si el build no tiene
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. La librería se carga recién acá
 * (no pesa en el arranque).
 */
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return Promise.resolve(null);
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'melanite-auth' } })));
}
