// Pruebas del servicio api/leer-remito.js con el modelo SIMULADO (no llama a Gemini).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { ErrorModelo, leerConReintentos } from '../../api/leer-remito.js';

const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1200, 7)]).toString('base64');
const OK = JSON.stringify({ proveedor: 'Lácteos del Sur', fecha: '2026-10-26', lineas: [{ descripcion: 'MANTECA PEPITO 200 GR', cantidad: 10, fecha_vencimiento: null, confianza: 0.95 }] });

function respuesta() {
  return { statusCode: 0, headers: {}, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}
const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: OK }] } }] }), { status: 200 });
const gemini503 = () => new Response('{"error":{"code":503,"message":"The model is overloaded."}}', { status: 503 });
const colgado = (signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abortado'))));

beforeEach(() => {
  Object.assign(process.env, { VISION_API_KEY: 'AIza-prueba', VISION_PRESUPUESTO_MS: '1500', VISION_INTENTO_MS: '400', VISION_MINIMO_MS: '100', VISION_ESPERA_MS: '50' });
  delete process.env.VISION_MODEL; delete process.env.VISION_MODEL_RESPALDO; delete process.env.VISION_PROVIDER;
});
afterEach(() => vi.restoreAllMocks());

describe('reintentos y tiempos', () => {
  const base = { proveedor: 'gemini', clave: 'k', modelos: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'], mime: 'image/jpeg', base64: 'x', prompt: 'p' };

  it('503 transitorio: reintenta con el modelo de respaldo y lee', async () => {
    const llamar = vi.fn().mockRejectedValueOnce(new ErrorModelo('gemini', 503, 'overloaded')).mockResolvedValueOnce(OK);
    const r = await leerConReintentos(base, llamar);
    expect(r.texto).toBe(OK);
    expect(llamar.mock.calls.map((c) => c[2])).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });
  it('503 siempre: corta en 3 intentos y avisa «no disponible», dentro del presupuesto', async () => {
    const llamar = vi.fn().mockRejectedValue(new ErrorModelo('gemini', 503, 'overloaded'));
    const t0 = Date.now();
    await expect(leerConReintentos(base, llamar)).rejects.toMatchObject({ tipo: 'no_disponible' });
    expect(llamar).toHaveBeenCalledTimes(3);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('modelo que no responde: cada intento se corta a tiempo y el total no supera el presupuesto', async () => {
    const llamar = vi.fn((...a) => colgado(a[6]));
    const t0 = Date.now();
    await expect(leerConReintentos(base, llamar)).rejects.toMatchObject({ tipo: 'demora' });
    const total = Date.now() - t0;
    expect(total).toBeLessThan(1500);
    expect(llamar.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it('error de configuración (401/404) no se reintenta', async () => {
    const llamar = vi.fn().mockRejectedValue(new ErrorModelo('gemini', 404, 'model not found'));
    await expect(leerConReintentos(base, llamar)).rejects.toMatchObject({ tipo: 'config' });
    expect(llamar).toHaveBeenCalledTimes(1);
  });
});

describe('función /api/leer-remito (Gemini simulado)', () => {
  it('503 y después OK → 200 con la lectura; desactiva el razonamiento en 2.5 Flash', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(gemini503()).mockResolvedValueOnce(geminiOk());
    const res = respuesta();
    await handler({ method: 'POST', body: { imagen: JPEG, productos: ['Manteca Pepito 200 g'] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.lineas[0].descripcion).toBe('MANTECA PEPITO 200 GR');
    expect(f).toHaveBeenCalledTimes(2);
    const cuerpo = JSON.parse(f.mock.calls[0][1].body);
    expect(cuerpo.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(f.mock.calls[0][0]).toContain('gemini-2.5-flash:');
    expect(f.mock.calls[1][0]).toContain('gemini-2.5-flash-lite:');
  });
  it('servicio caído → 503 con mensaje útil, Retry-After y sin lectura inventada', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => gemini503());
    const res = respuesta();
    await handler({ method: 'POST', body: { imagen: JPEG, productos: [] } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: 'no_disponible', reintentable: true });
    expect(res.body.lineas).toBeUndefined();
    expect(res.headers['Retry-After']).toBe('30');
  });
  it('modelo colgado → 504 «tardó demasiado» antes del límite de Vercel', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_, o) => colgado(o.signal));
    const res = respuesta();
    const t0 = Date.now();
    await handler({ method: 'POST', body: { imagen: JPEG, productos: [] } }, res);
    expect(res.statusCode).toBe(504);
    expect(res.body.error).toBe('demora');
    expect(Date.now() - t0).toBeLessThan(1600);
  });
  it('la misma foto enviada dos veces a la vez se lee una sola vez', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { await new Promise((r) => setTimeout(r, 100)); return geminiOk(); });
    const [a, b] = [respuesta(), respuesta()];
    await Promise.all([
      handler({ method: 'POST', body: { imagen: JPEG, productos: ['x'] } }, a),
      handler({ method: 'POST', body: { imagen: JPEG, productos: ['x'] } }, b),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('archivo que no es imagen o demasiado grande → 400/413 sin llamar a la IA', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r1 = respuesta();
    await handler({ method: 'POST', body: { imagen: 'data:image/jpeg;base64,' + Buffer.alloc(2000, 65).toString('base64') } }, r1);
    const r2 = respuesta();
    await handler({ method: 'POST', body: { imagen: 'data:image/jpeg;base64,' + 'A'.repeat(2_200_000) } }, r2);
    expect([r1.statusCode, r2.statusCode]).toEqual([400, 413]);
    expect(f).not.toHaveBeenCalled();
  });
});
