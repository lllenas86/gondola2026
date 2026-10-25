// Remitos de ejemplo para el modo demo. Son empresas ficticias.
// La imagen se genera como SVG con la fecha de hoy, y la "extracción" simula
// lo que devolvería un modelo de IA con visión, con errores a propósito para
// poder probar la pantalla de revisión.

import { addDays, isoDate, startOfDay } from '../lib/dates';

export interface LineaExtraida {
  descripcion: string;
  cantidad: number | null;
  fechaVencimiento?: string;
  /** Qué tan segura está la IA de haber leído bien la línea (0 a 1). */
  confianzaLectura?: number;
}

export interface Extraccion {
  proveedor: string;
  fecha: string;
  lineas: LineaExtraida[];
}

export interface RemitoEjemplo {
  id: string;
  titulo: string;
  proveedor: string;
  numero: string;
  direccion: string;
  /** Lo que figura impreso en el remito */
  lineas: { cantidad: number; descripcion: string; vto?: string }[];
  /** Lo que "leyó" la IA simulada */
  extraccion: (hoy: Date) => Extraccion;
}

const ddmmaa = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
const dia = (n: number, hoy: Date) => isoDate(addDays(startOfDay(hoy), n));

export const REMITOS_EJEMPLO: RemitoEjemplo[] = [
  {
    id: 'lacteos',
    titulo: 'Lácteos del Sur',
    proveedor: 'LÁCTEOS DEL SUR S.R.L.',
    numero: '0003-00018452',
    direccion: 'Ruta 9 km 312 · Rosario',
    lineas: [
      { cantidad: 24, descripcion: 'LECHE ENTERA SACHET 1 LT', vto: '+12' },
      { cantidad: 12, descripcion: 'YOG. BEB. FRUT. 1LT', vto: '+15' },
      { cantidad: 6, descripcion: 'QUESO CREMA X 290 G', vto: '+30' },
    ],
    extraccion: (hoy) => ({
      proveedor: 'LÁCTEOS DEL SUR S.R.L.',
      fecha: dia(0, hoy),
      lineas: [
        { descripcion: 'LECHE ENTERA SACHET 1 LT', cantidad: 24, fechaVencimiento: dia(12, hoy), confianzaLectura: 0.97 },
        // Error a propósito: en el remito dice 12, la IA leyó 18 y no está segura.
        { descripcion: 'YOG. BEB. FRUT. 1LT', cantidad: 18, fechaVencimiento: dia(15, hoy), confianzaLectura: 0.55 },
        // Producto que no está en el catálogo.
        { descripcion: 'QUESO CREMA X 290 G', cantidad: 6, fechaVencimiento: dia(30, hoy), confianzaLectura: 0.93 },
      ],
    }),
  },
  {
    id: 'centro',
    titulo: 'Distribuidora Centro',
    proveedor: 'DISTRIBUIDORA CENTRO S.A.',
    numero: '0001-00004127',
    direccion: 'Av. Ficticia 1234 · Rosario',
    lineas: [
      { cantidad: 12, descripcion: 'COCA COLA 2,25 LT' },
      { cantidad: 12, descripcion: 'COCA COLA 500 CC' },
      { cantidad: 6, descripcion: 'SPRITE LIMA-LIMON 2,25 LT' },
      { cantidad: 12, descripcion: 'AGUA MIN. S/GAS 1500 CC' },
      { cantidad: 6, descripcion: 'FANTA NARANJA 2,25 LT' },
    ],
    extraccion: (hoy) => ({
      proveedor: 'DISTRIBUIDORA CENTRO S.A.',
      fecha: dia(0, hoy),
      lineas: [
        { descripcion: 'COCA COLA 2,25 LT', cantidad: 12, confianzaLectura: 0.98 },
        // Otra presentación del mismo producto: se distingue por el tamaño.
        { descripcion: 'COCA COLA 500 CC', cantidad: 12, confianzaLectura: 0.92 },
        { descripcion: 'SPRITE LIMA-LIMON 2,25 LT', cantidad: 6, confianzaLectura: 0.95 },
        // Lectura dudosa: la cantidad quedó borrosa en la foto.
        { descripcion: 'AGUA MIN. S/GAS 1500 CC', cantidad: 12, confianzaLectura: 0.6 },
        // Producto que no está en el catálogo.
        { descripcion: 'FANTA NARANJA 2,25 LT', cantidad: 6, confianzaLectura: 0.94 },
      ],
    }),
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Dibuja el remito como una foto de un papel sobre el mostrador. */
export function svgRemito(r: RemitoEjemplo, hoy: Date): string {
  const W = 640;
  const H = 860;
  const filaY0 = 380;
  const altoFila = 46;
  const filas = r.lineas
    .map((l, i) => {
      const y = filaY0 + i * altoFila;
      const vto = l.vto ? ddmmaa(dia(Number(l.vto), hoy)) : '';
      return `
      <line x1="60" y1="${y + 14}" x2="580" y2="${y + 14}" stroke="#d6d3cc"/>
      <text x="92" y="${y}" text-anchor="middle" font-family="'Courier New',monospace" font-size="20" fill="#1f2a44">${l.cantidad}</text>
      <text x="140" y="${y}" font-family="'Courier New',monospace" font-size="18" fill="#1f2a44">${esc(l.descripcion)}</text>
      <text x="566" y="${y}" text-anchor="end" font-family="'Courier New',monospace" font-size="17" fill="#1f2a44">${vto}</text>`;
    })
    .join('');
  const totalBultos = r.lineas.reduce((a, l) => a + l.cantidad, 0);
  const fecha = ddmmaa(isoDate(hoy));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W + 80} ${H + 80}" width="${W + 80}" height="${H + 80}">
  <defs>
    <linearGradient id="mesa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a6f55"/><stop offset="1" stop-color="#6d5641"/></linearGradient>
    <filter id="sombra" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="6" dy="10" stdDeviation="10" flood-opacity="0.35"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#mesa)"/>
  <g transform="translate(40 40) rotate(-1.2 ${W / 2} ${H / 2})" filter="url(#sombra)">
    <rect width="${W}" height="${H}" fill="#fbfaf6"/>
    <rect x="30" y="30" width="${W - 60}" height="150" fill="none" stroke="#1f2a44" stroke-width="1.5"/>
    <line x1="${W / 2}" y1="30" x2="${W / 2}" y2="180" stroke="#1f2a44" stroke-width="1.5"/>
    <rect x="${W / 2 - 28}" y="30" width="56" height="56" fill="#fbfaf6" stroke="#1f2a44" stroke-width="1.5"/>
    <text x="${W / 2}" y="72" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#1f2a44">R</text>
    <text x="50" y="80" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#1f2a44">${esc(r.proveedor)}</text>
    <text x="50" y="108" font-family="Arial,Helvetica,sans-serif" font-size="12.5" fill="#3b4660">${esc(r.direccion)}</text>
    <text x="50" y="130" font-family="Arial,Helvetica,sans-serif" font-size="12.5" fill="#3b4660">IVA Responsable Inscripto</text>
    <text x="50" y="160" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#9a3412" font-weight="700">EJEMPLO FICTICIO PARA DEMOSTRACIÓN</text>
    <text x="${W / 2 + 45}" y="80" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#1f2a44">REMITO</text>
    <text x="${W / 2 + 45}" y="108" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#1f2a44">N° ${r.numero}</text>
    <text x="${W / 2 + 45}" y="138" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#1f2a44">Fecha: ${fecha}</text>
    <text x="${W / 2 + 45}" y="162" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#3b4660">Documento no válido como factura</text>

    <text x="40" y="225" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#1f2a44">Señor/es: <tspan font-weight="700">ALMACÉN DE BARRIO</tspan></text>
    <text x="40" y="250" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#1f2a44">Condición de venta: Cuenta corriente</text>
    <text x="40" y="275" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#1f2a44">Reparto: Zona centro</text>

    <rect x="40" y="315" width="${W - 80}" height="34" fill="#e8ecf4" stroke="#1f2a44" stroke-width="1"/>
    <text x="92" y="338" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="#1f2a44">CANT.</text>
    <text x="140" y="338" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="#1f2a44">DESCRIPCIÓN</text>
    <text x="566" y="338" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="#1f2a44">VTO.</text>
    ${filas}
    <text x="40" y="${filaY0 + r.lineas.length * altoFila + 30}" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#1f2a44">Total de unidades: ${totalBultos}</text>

    <line x1="60" y1="${H - 110}" x2="270" y2="${H - 110}" stroke="#1f2a44"/>
    <text x="165" y="${H - 88}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#3b4660">Firma y aclaración</text>
    <line x1="370" y1="${H - 110}" x2="580" y2="${H - 110}" stroke="#1f2a44"/>
    <text x="475" y="${H - 88}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#3b4660">Recibí conforme</text>
    <path d="M90 ${H - 125} c 20 -25, 35 10, 55 -8 s 30 -12, 45 4 s 25 -2, 40 -10" fill="none" stroke="#2c3e8f" stroke-width="2"/>
  </g>
</svg>`;
}

export function urlRemitoEjemplo(id: string, hoy: Date = new Date()): string | null {
  const r = REMITOS_EJEMPLO.find((x) => x.id === id);
  if (!r) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgRemito(r, hoy))}`;
}
