import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Además de las VITE_, se exponen las NEXT_PUBLIC_ (así se llaman las de Supabase en Vercel).
  // Solo se exponen variables públicas: las claves privadas (VISION_API_KEY) no llevan ese prefijo.
  // En MODO DEMO no se expone NINGUNA variable (.env.local incluido): la demo queda aislada de producción.
  envPrefix: mode === 'demo' ? ['GONDOLA_DEMO_SOLO_'] : ['VITE_', 'NEXT_PUBLIC_'],
  // MODO DEMO solo con `--mode demo` (npm run demo / build:demo). En la versión normal queda
  // en "0" y el código de la demo (PGlite) ni siquiera entra en el paquete.
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify(mode === 'demo' ? '1' : '0') },
  // PGlite (base de prueba del modo demo) trae su propio WebAssembly: no se pre-empaqueta.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
}));
