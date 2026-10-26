// Función del servidor (Vercel): lee la foto de un remito con un modelo de IA con visión.
//
// POST /api/leer-remito   { imagen: "data:image/jpeg;base64,…", productos: ["Leche entera 1 L", …] }
// → 200 { proveedor, fecha, lineas: [{ descripcion, cantidad, fecha_vencimiento, confianza }] }
// → 4xx/5xx { error, mensaje, reintentable }
//
// Variables de entorno en Vercel (SIN NEXT_PUBLIC_: nunca llegan al navegador):
//   VISION_API_KEY         clave del modelo (obligatoria)
//   VISION_PROVIDER        "gemini", "anthropic" u "openai" (opcional: se deduce de la clave)
//   VISION_MODEL           modelo a usar (opcional)
//   VISION_MODEL_RESPALDO  modelo de respaldo del MISMO proveedor y la misma clave (opcional;
//                          en Gemini, por defecto gemini-2.5-flash-lite; "no" lo desactiva)
//
// Robustez (la función tiene 60 s en Vercel, ver vercel.json):
//   - cada intento tiene un tiempo máximo explícito (AbortController);
//   - hasta 3 intentos SOLO ante errores transitorios (429, 5xx, red, demora), con espera
//     progresiva y variación aleatoria; el 2.º intento usa el modelo de respaldo si hay;
//   - presupuesto total de 50 s: nunca se empieza un intento que no pueda terminar a tiempo;
//   - errores de configuración (400/401/403/404) no se reintentan;
//   - dos pedidos iguales al mismo tiempo comparten la misma lectura (no se paga dos veces).

import { createHash } from 'node:crypto';

const MODELOS = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
};
const RESPALDO = { gemini: 'gemini-2.5-flash-lite' };

const MAX_BASE64 = 2_100_000; // ≈ 1,5 MB de imagen
const MIN_BASE64 = 1_000; // menos de ~750 bytes no es una foto
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
/** Tiempos (se pueden achicar en las pruebas con variables de entorno). */
const tiempos = () => ({
  presupuesto: num(process.env.VISION_PRESUPUESTO_MS, 50_000),
  porIntento: num(process.env.VISION_INTENTO_MS, 25_000),
  minimoIntento: num(process.env.VISION_MINIMO_MS, 5_000),
  espera: num(process.env.VISION_ESPERA_MS, 800),
  intentos: num(process.env.VISION_INTENTOS, 3),
});

/** Error del proveedor de IA, con el código HTTP para decidir si se reintenta. */
export class ErrorModelo extends Error {
  constructor(proveedor, status, detalle) {
    super(`${proveedor} ${status}: ${String(detalle).slice(0, 300)}`);
    this.status = status;
  }
}
const esTransitorio = (e) => !(e instanceof ErrorModelo) || [408, 429, 500, 502, 503, 504].includes(e.status);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function proveedorDesdeClave(clave) {
  if (clave.startsWith('sk-ant-')) return 'anthropic';
  if (clave.startsWith('AIza')) return 'gemini';
  if (clave.startsWith('sk-')) return 'openai';
  return 'gemini';
}

function instrucciones(productos) {
  const lista = productos.length > 0 ? productos.map((p) => `- ${p}`).join('\n') : '(sin productos cargados)';
  return `Sos un asistente que lee fotos de remitos de proveedores de un almacén de Argentina.
Leé la imagen y respondé SOLO con un objeto JSON válido, sin texto antes ni después y sin bloques de código, con este formato exacto:
{"proveedor": "texto tal como figura", "fecha": "AAAA-MM-DD o null", "lineas": [{"descripcion": "texto del remito", "cantidad": 12, "fecha_vencimiento": "AAAA-MM-DD o null", "confianza": 0.0}]}

Reglas:
- "proveedor": razón social o nombre del proveedor tal como figura en el remito.
- "fecha": fecha del remito. En Argentina las fechas se escriben DD/MM/AA o DD/MM/AAAA: convertilas a AAAA-MM-DD. Si no se lee, null.
- Una línea por cada renglón de mercadería. "descripcion": copiá el texto tal como figura en el remito (no lo reemplaces por el nombre del catálogo).
- "cantidad": número de unidades entregadas. Si no se puede leer, null.
- "fecha_vencimiento": si el renglón tiene vencimiento, en AAAA-MM-DD; si no, null.
- "confianza": número de 0 a 1 que indica qué tan seguro estás de haber leído bien la descripción y la cantidad de esa línea. Usá valores bajos si la letra está borrosa, cortada o es ambigua.
- No inventes renglones. Si la imagen no es un remito o no se puede leer, devolvé "lineas": [].

Productos del catálogo del almacén (solo para ayudarte a interpretar abreviaturas):
${lista}`;
}

async function llamarModelo(proveedor, clave, modelo, mime, base64, prompt, signal) {
  if (proveedor === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 2000,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!r.ok) throw new ErrorModelo('anthropic', r.status, await r.text());
    const d = await r.json();
    return (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  if (proveedor === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        }],
      }),
    });
    if (!r.ok) throw new ErrorModelo('openai', r.status, await r.text());
    const d = await r.json();
    return d.choices?.[0]?.message?.content ?? '';
  }

  // Gemini
  // En Gemini 2.5 Flash el "razonamiento" está activo por defecto y multiplica la demora
  // (40-60 s por remito): para leer un remito no hace falta, se desactiva.
  const sinRazonar = /^gemini-2\.5-flash/.test(modelo) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': clave },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json', ...sinRazonar },
    }),
  });
  if (!r.ok) throw new ErrorModelo('gemini', r.status, await r.text());
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/** Saca el primer objeto JSON del texto (por si el modelo agrega ```json … ```). */
export function extraerJson(texto) {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/```(?:json)?/gi, '').trim();
  const ini = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (ini < 0 || fin <= ini) return null;
  try {
    return JSON.parse(limpio.slice(ini, fin + 1));
  } catch {
    return null;
  }
}

const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Deja la respuesta con el formato exacto de la consigna. */
export function normalizar(d) {
  const lineas = Array.isArray(d?.lineas) ? d.lineas : [];
  return {
    proveedor: typeof d?.proveedor === 'string' ? d.proveedor : null,
    fecha: esFecha(d?.fecha) ? d.fecha : null,
    lineas: lineas
      .filter((l) => l && typeof l.descripcion === 'string' && l.descripcion.trim() !== '')
      .map((l) => {
        const vacia = l.cantidad === null || l.cantidad === undefined || String(l.cantidad).trim() === '';
        const cantidad = vacia ? NaN : typeof l.cantidad === 'number' ? l.cantidad : Number(String(l.cantidad).replace(',', '.'));
        const confianza = Number(l.confianza);
        return {
          descripcion: l.descripcion.trim(),
          cantidad: Number.isFinite(cantidad) ? cantidad : null,
          fecha_vencimiento: esFecha(l.fecha_vencimiento) ? l.fecha_vencimiento : null,
          confianza: Number.isFinite(confianza) ? Math.max(0, Math.min(1, confianza)) : 0.5,
        };
      }),
  };
}

/** Primeros bytes de cada formato admitido (para no mandarle al modelo algo que no es una imagen). */
function formatoReal(base64) {
  const b = Buffer.from(base64.slice(0, 24), 'base64');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Llama al modelo con tiempo máximo por intento, reintentos limitados y presupuesto total.
 * Devuelve { texto, intentos } o lanza { tipo: 'config' | 'no_disponible' | 'demora', intentos }.
 */
export async function leerConReintentos({ proveedor, clave, modelos, mime, base64, prompt }, llamar = llamarModelo) {
  const t = tiempos();
  const inicio = Date.now();
  const intentos = [];
  let ultimo = null;
  for (let n = 0; n < t.intentos; n++) {
    const restante = t.presupuesto - (Date.now() - inicio);
    if (restante < t.minimoIntento) break;
    const modelo = modelos[Math.min(n, modelos.length - 1)];
    const limite = Math.min(t.porIntento, restante);
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), limite);
    const t0 = Date.now();
    try {
      const texto = await llamar(proveedor, clave, modelo, mime, base64, prompt, control.signal);
      intentos.push({ modelo, ms: Date.now() - t0, status: 200 });
      return { texto, intentos };
    } catch (e) {
      const status = e instanceof ErrorModelo ? e.status : control.signal.aborted ? 'demora' : 'red';
      intentos.push({ modelo, ms: Date.now() - t0, status });
      ultimo = e;
      if (!esTransitorio(e)) throw { tipo: 'config', intentos, causa: e };
    } finally {
      clearTimeout(reloj);
    }
    // Espera progresiva con variación aleatoria, solo si todavía queda tiempo para otro intento
    const espera = t.espera * 2 ** n + Math.floor(Math.random() * t.espera * 0.5);
    if (t.presupuesto - (Date.now() - inicio) - espera < t.minimoIntento) break;
    await dormir(espera);
  }
  const todosDemora = intentos.length > 0 && intentos.every((x) => x.status === 'demora');
  throw { tipo: todosDemora ? 'demora' : 'no_disponible', intentos, causa: ultimo };
}

/** Pedidos en curso (la misma foto enviada dos veces a la vez comparte la lectura). */
const enCurso = new Map();

const MENSAJES = {
  config: 'La lectura con IA no está disponible por un problema de configuración. Cargá el remito a mano y avisale al administrador.',
  no_disponible: 'El servicio de IA está saturado en este momento. Probá de nuevo en unos minutos o cargá el remito a mano.',
  demora: 'La IA tardó demasiado en leer el remito. Probá de nuevo o cargalo a mano.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'metodo', mensaje: 'Usá POST.' });
  }

  const clave = process.env.VISION_API_KEY;
  if (!clave) {
    return res.status(503).json({ error: 'sin_ia', mensaje: 'La lectura con IA no está configurada (falta VISION_API_KEY en Vercel).', reintentable: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const imagen = body?.imagen;
  const productos = Array.isArray(body?.productos) ? body.productos.filter((p) => typeof p === 'string').slice(0, 300) : [];
  const m = typeof imagen === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imagen) : null;
  if (!m) return res.status(400).json({ error: 'imagen', mensaje: 'No llegó una imagen válida (JPG, PNG o WEBP).', reintentable: false });
  if (m[2].length > MAX_BASE64) return res.status(413).json({ error: 'imagen', mensaje: 'La foto pesa demasiado (máximo 1,5 MB).', reintentable: false });
  if (m[2].length < MIN_BASE64 || !formatoReal(m[2])) {
    return res.status(400).json({ error: 'imagen', mensaje: 'El archivo no es una foto válida.', reintentable: false });
  }
  const mime = formatoReal(m[2]);

  const proveedor = (process.env.VISION_PROVIDER || proveedorDesdeClave(clave)).toLowerCase();
  const modelo = process.env.VISION_MODEL || MODELOS[proveedor] || MODELOS.gemini;
  const respaldoEnv = process.env.VISION_MODEL_RESPALDO;
  const respaldo = respaldoEnv === 'no' ? null : respaldoEnv || RESPALDO[proveedor] || null;
  const modelos = respaldo && respaldo !== modelo ? [modelo, respaldo, modelo] : [modelo];

  const inicio = Date.now();
  const huella = createHash('sha256').update(m[2]).update(JSON.stringify(productos)).digest('hex');
  let lectura = enCurso.get(huella);
  const compartida = !!lectura;
  if (!lectura) {
    lectura = leerConReintentos({ proveedor, clave, modelos, mime, base64: m[2], prompt: instrucciones(productos) });
    enCurso.set(huella, lectura);
    lectura.finally(() => enCurso.delete(huella)).catch(() => {});
  }

  let texto;
  try {
    ({ texto } = await lectura.then((r) => {
      console.info(JSON.stringify({ evento: 'leer-remito', resultado: 'ok', total_ms: Date.now() - inicio, intentos: r.intentos, compartida }));
      return r;
    }));
  } catch (e) {
    const tipo = e?.tipo ?? 'no_disponible';
    console.error(JSON.stringify({ evento: 'leer-remito', resultado: tipo, total_ms: Date.now() - inicio, intentos: e?.intentos ?? [], compartida, causa: String(e?.causa?.message ?? e).slice(0, 300) }));
    const status = tipo === 'config' ? 502 : tipo === 'demora' ? 504 : 503;
    if (tipo !== 'config') res.setHeader('Retry-After', '30');
    return res.status(status).json({ error: tipo, mensaje: MENSAJES[tipo], reintentable: tipo !== 'config' });
  }

  const datos = extraerJson(texto);
  if (!datos) {
    return res.status(422).json({ error: 'ilegible', mensaje: 'No se pudo leer el remito: la imagen no es legible o no parece un remito.', reintentable: false });
  }
  const resultado = normalizar(datos);
  if (resultado.lineas.length === 0) {
    return res.status(422).json({ error: 'ilegible', mensaje: 'No se pudo leer el remito: la imagen no es legible o no parece un remito.', reintentable: false });
  }
  return res.status(200).json(resultado);
}
