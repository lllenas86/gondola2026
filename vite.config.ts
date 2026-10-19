import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Además de las VITE_, se exponen las NEXT_PUBLIC_ (así se llaman las de Supabase en Vercel).
  // Solo se exponen variables públicas: las claves privadas (VISION_API_KEY) no llevan ese prefijo.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
