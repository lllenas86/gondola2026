// Indicador visible del MODO DEMO, con los usuarios de prueba y el botón para reiniciar.
import { CLAVE_DEMO, USUARIOS_DEMO, reiniciarDemo } from './backend';

export function mostrarBanner() {
  const caja = document.createElement('div');
  caja.setAttribute('role', 'status');
  caja.style.cssText =
    'position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;' +
    'font:600 12px/1.3 system-ui,sans-serif;max-width:calc(100vw - 24px)';
  const boton = document.createElement('button');
  boton.textContent = 'MODO DEMO · DATOS DE PRUEBA';
  boton.style.cssText =
    'background:#b45309;color:#fff;border:0;border-radius:999px;padding:6px 12px;letter-spacing:.04em;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;display:block;margin:0 auto';
  const panel = document.createElement('div');
  panel.hidden = true;
  panel.style.cssText =
    'margin-bottom:8px;background:#fffbeb;color:#422006;border:1px solid #f59e0b;border-radius:12px;padding:12px;' +
    'font-weight:400;box-shadow:0 4px 16px rgba(0,0,0,.2);width:300px;max-width:100%';
  panel.innerHTML =
    '<strong>Demo de prueba.</strong> Todo funciona dentro de este navegador: no se conecta a la base real ni a la app publicada. ' +
    'El login es simulado (no es un login seguro) y la lectura de remitos es simulada (no hay IA conectada: devuelve siempre los remitos de ejemplo).' +
    '<div style="margin:8px 0 4px;font-weight:600">Usuarios de prueba · clave <code>' + CLAVE_DEMO + '</code></div>' +
    USUARIOS_DEMO.map((u) => `<div>${u.rol}: <code>${u.email}</code></div>`).join('');
  const reiniciar = document.createElement('button');
  reiniciar.textContent = 'Reiniciar demo (vuelve a los datos de ejemplo)';
  reiniciar.style.cssText = 'margin-top:10px;width:100%;padding:8px;border-radius:8px;border:1px solid #b45309;background:#fff;color:#b45309;font-weight:600;cursor:pointer';
  reiniciar.onclick = () => {
    if (confirm('¿Borrar todo lo que cargaste en la demo y volver a los datos de ejemplo?')) void reiniciarDemo();
  };
  panel.appendChild(reiniciar);
  boton.onclick = () => (panel.hidden = !panel.hidden);
  caja.append(panel, boton);
  document.body.appendChild(caja);
}
