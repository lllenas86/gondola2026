// Función del servidor (Vercel): lee la foto de un remito con un modelo de IA con visión.
//
// POST /api/leer-remito   { imagen: "data:image/jpeg;base64,…", productos: ["Leche entera 1 L", …] }
// → 200 { proveedor, fecha, lineas: [{ descripcion, cantidad, fecha_vencimiento, confianza }] }
//
// Variables de entorno en Vercel (SIN NEXT_PUBLIC_: nunca llegan al navegador):
//   VISION_API_KEY   clave del modelo (obligatoria)
//   VISION_PROVIDER  "gemini", "anthropic" u "openai" (opcional: se deduce de la clave)
//   VISION_MODEL     modelo a usar (opcional)

const MODELOS = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
};

const MAX_BASE64 = 2_100_000; // ≈ 1,5 MB de imagen

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

async function llamarModelo(proveedor, clave, modelo, mime, base64, prompt) {
  if (proveedor === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const d = await r.json();
    return (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  if (proveedor === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
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
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const d = await r.json();
    return d.choices?.[0]?.message?.content ?? '';
  }

  // Gemini
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': clave },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'metodo', mensaje: 'Usá POST.' });
  }

  const clave = process.env.VISION_API_KEY;
  if (!clave) {
    return res.status(503).json({ error: 'sin_ia', mensaje: 'La lectura con IA no está configurada (falta VISION_API_KEY en Vercel).' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const imagen = body?.imagen;
  const productos = Array.isArray(body?.productos) ? body.productos.filter((p) => typeof p === 'string').slice(0, 300) : [];
  const m = typeof imagen === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imagen) : null;
  if (!m) return res.status(400).json({ error: 'imagen', mensaje: 'No llegó una imagen válida.' });
  if (m[2].length > MAX_BASE64) return res.status(413).json({ error: 'imagen', mensaje: 'La foto pesa demasiado (máximo 1,5 MB).' });

  const proveedor = (process.env.VISION_PROVIDER || proveedorDesdeClave(clave)).toLowerCase();
  const modelo = process.env.VISION_MODEL || MODELOS[proveedor] || MODELOS.gemini;

  let texto;
  try {
    texto = await llamarModelo(proveedor, clave, modelo, m[1], m[2], instrucciones(productos));
  } catch (e) {
    console.error('leer-remito: falló el modelo', e);
    return res.status(502).json({ error: 'modelo', mensaje: 'El servicio de IA no pudo leer la foto en este momento. Probá de nuevo o cargalo a mano.' });
  }

  const datos = extraerJson(texto);
  if (!datos) {
    return res.status(422).json({ error: 'ilegible', mensaje: 'No se pudo leer el remito: la imagen no es legible o no parece un remito.' });
  }
  const resultado = normalizar(datos);
  if (resultado.lineas.length === 0) {
    return res.status(422).json({ error: 'ilegible', mensaje: 'No se pudo leer el remito: la imagen no es legible o no parece un remito.' });
  }
  return res.status(200).json(resultado);
}
