/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del proyecto de Supabase */
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
  /** Clave pública de Supabase (se acepta cualquiera de los dos nombres) */
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** URL alternativa del servicio que lee remitos (por defecto /api/leer-remito) */
  readonly VITE_REMITO_API_URL?: string;
}
