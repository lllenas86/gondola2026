import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

async function arrancar() {
  // MODO DEMO (solo con `--mode demo`): base de prueba en el navegador, sin Supabase real.
  if (import.meta.env.VITE_DEMO === '1') {
    const raiz = document.getElementById('root')!;
    raiz.innerHTML = '<p style="font:16px system-ui;padding:24px;text-align:center">Preparando la demo…</p>';
    const [{ instalar, reiniciarDemo }, { mostrarBanner }] = await Promise.all([import('./demo/backend'), import('./demo/banner')]);
    try {
      await instalar(() => {
        raiz.innerHTML = '<p style="font:16px system-ui;padding:24px;text-align:center">Preparando la demo…<br><small>Si la demo está abierta en otra pestaña, cerrala para seguir acá.</small></p>';
      });
    } catch (e) {
      raiz.innerHTML = '<div style="font:16px system-ui;padding:24px;text-align:center"><p>No se pudo abrir la base de la demo.</p><p style="color:#666;font-size:13px"></p><button style="padding:10px 16px;font-size:15px">Reiniciar demo</button></div>';
      raiz.querySelector('p + p')!.textContent = e instanceof Error ? e.message : String(e);
      raiz.querySelector('button')!.addEventListener('click', () => void reiniciarDemo());
      return;
    }
    raiz.innerHTML = '';
    mostrarBanner();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void arrancar();
