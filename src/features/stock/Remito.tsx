import type { AppData, Devolucion } from '../../types';
import { formatFechaCorta, formatFechaHora } from '../../lib/dates';
import { ESTADOS_DEVOLUCION, MOTIVOS, numeroRemito } from '../../lib/vencimientos';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export interface DatosRemito {
  titulo: string;
  numero: string;
  fecha: string;
  proveedor: string;
  motivo: string;
  estado: string;
  respuesta: string;
  nota?: string;
  lineas: { producto: string; lote: string; cantidad: string; recepcion: string }[];
}

export function datosRemito(data: AppData, d: Devolucion): DatosRemito {
  return {
    titulo: d.tipo === 'cambio' ? 'Solicitud de cambio de mercadería' : 'Remito de devolución de mercadería',
    numero: numeroRemito(d.numero),
    fecha: formatFechaCorta(d.fecha) + '/' + d.fecha.slice(0, 4),
    proveedor: data.proveedores.find((p) => p.id === d.proveedorId)?.nombre ?? '—',
    motivo: MOTIVOS[d.motivo],
    estado: ESTADOS_DEVOLUCION[d.estado] + (d.entregadaEn ? ` (entregada ${formatFechaHora(d.entregadaEn)})` : ''),
    respuesta:
      d.respuestaProveedor === 'pendiente'
        ? 'Pendiente: sujeto a aceptación del proveedor'
        : `${d.respuestaProveedor === 'aceptada' ? 'Aceptada' : 'Rechazada'}${d.resolucion ? ` · ${d.resolucion}` : ''}`,
    ...(d.nota ? { nota: d.nota } : {}),
    lineas: d.lineas.map((l) => {
      const r = l.recepcionId ? data.recepciones.find((x) => x.id === l.recepcionId) : undefined;
      return {
        producto: data.productos.find((p) => p.id === l.productoId)?.nombre ?? 'Producto eliminado',
        lote: l.fechaVencimiento ? `Vence ${formatFechaCorta(l.fechaVencimiento)}/${l.fechaVencimiento.slice(0, 4)}` : '—',
        cantidad: fmt(l.cantidad),
        recepcion: r ? `Recibido ${formatFechaCorta(r.fecha)}` : '—',
      };
    }),
  };
}

const AVISO = 'Documento interno de control de mercadería. No es una factura ni un comprobante fiscal.';

/** Vista del remito en pantalla (se imprime con la clase .remito). */
export function Remito({ r }: { r: DatosRemito }) {
  return (
    <article className="remito" aria-label={`${r.titulo} N° ${r.numero}`}>
      <header className="remito-cabecera">
        <div>
          <p className="remito-titulo">{r.titulo}</p>
          <p className="remito-sub">Góndola · uso interno</p>
        </div>
        <div className="remito-numero">
          <span>N° {r.numero}</span>
          <span>{r.fecha}</span>
        </div>
      </header>
      <dl className="remito-datos">
        <div><dt>Proveedor</dt><dd>{r.proveedor}</dd></div>
        <div><dt>Motivo</dt><dd>{r.motivo}</dd></div>
        <div><dt>Estado</dt><dd>{r.estado}</dd></div>
        <div><dt>Respuesta del proveedor</dt><dd>{r.respuesta}</dd></div>
        {r.nota && <div><dt>Nota</dt><dd>{r.nota}</dd></div>}
      </dl>
      <table className="remito-tabla">
        <thead><tr><th>Producto / presentación</th><th>Lote</th><th>Ref.</th><th className="num">Cant.</th></tr></thead>
        <tbody>
          {r.lineas.map((l, i) => (
            <tr key={i}><td>{l.producto}</td><td>{l.lote}</td><td>{l.recepcion}</td><td className="num">{l.cantidad}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="remito-firmas">
        <div><span />Entregó (comercio)</div>
        <div><span />Recibió (proveedor) · aclaración</div>
      </div>
      <p className="remito-aviso">{AVISO}</p>
    </article>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Remito como archivo HTML autónomo (se abre en cualquier navegador y se puede imprimir). */
export function remitoHtml(r: DatosRemito): string {
  const filas = r.lineas
    .map((l) => `<tr><td>${esc(l.producto)}</td><td>${esc(l.lote)}</td><td>${esc(l.recepcion)}</td><td class="num">${esc(l.cantidad)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.titulo)} N° ${esc(r.numero)}</title>
<style>
body{font-family:system-ui,Arial,sans-serif;color:#0f172a;margin:24px;max-width:760px}
header{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:12px}
h1{font-size:20px;margin:0}.sub{color:#5b6b82;font-size:13px;margin:2px 0 0}.nro{text-align:right;font-weight:700}
dl{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin:0 0 14px}dt{font-size:12px;color:#5b6b82}dd{margin:0;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #94a3b8;padding:6px 8px;text-align:left}th{background:#f1f5f9}.num{text-align:right}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:56px;font-size:13px;color:#5b6b82}.firmas div{border-top:1px solid #0f172a;padding-top:4px}
.aviso{margin-top:24px;font-size:12px;color:#5b6b82;border-top:1px dashed #94a3b8;padding-top:8px}
</style></head><body>
<header><div><h1>${esc(r.titulo)}</h1><p class="sub">Góndola · uso interno</p></div><div class="nro">N° ${esc(r.numero)}<br>${esc(r.fecha)}</div></header>
<dl><div><dt>Proveedor</dt><dd>${esc(r.proveedor)}</dd></div><div><dt>Motivo</dt><dd>${esc(r.motivo)}</dd></div>
<div><dt>Estado</dt><dd>${esc(r.estado)}</dd></div><div><dt>Respuesta del proveedor</dt><dd>${esc(r.respuesta)}</dd></div>
${r.nota ? `<div><dt>Nota</dt><dd>${esc(r.nota)}</dd></div>` : ''}</dl>
<table><thead><tr><th>Producto / presentación</th><th>Lote</th><th>Ref.</th><th class="num">Cant.</th></tr></thead><tbody>${filas}</tbody></table>
<div class="firmas"><div>Entregó (comercio)</div><div>Recibió (proveedor) · aclaración</div></div>
<p class="aviso">${esc(AVISO)}</p>
</body></html>`;
}

export function descargarRemito(r: DatosRemito): void {
  const blob = new Blob([remitoHtml(r)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `remito-devolucion-${r.numero}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Imprime solo el remito (el resto de la pantalla se oculta con CSS de impresión). */
export function imprimirRemito(): void {
  document.body.classList.add('imprimiendo-remito');
  const fin = () => {
    document.body.classList.remove('imprimiendo-remito');
    window.removeEventListener('afterprint', fin);
  };
  window.addEventListener('afterprint', fin);
  window.print();
}
